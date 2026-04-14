package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/infrawatch/ingest/internal/auth"
	"github.com/infrawatch/ingest/internal/config"
	"github.com/infrawatch/ingest/internal/db"
	"github.com/infrawatch/ingest/internal/handlers"
	ingestgrpc "github.com/infrawatch/ingest/internal/grpc"
	"github.com/infrawatch/ingest/internal/queue/inprocess"
	ingesttls "github.com/infrawatch/ingest/internal/tls"
)

func main() {
	configPath := flag.String("config", "/etc/infrawatch/ingest.yaml", "Path to ingest YAML config file")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("loading config", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Connect to database
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connecting to database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("database connected")

	// Set up JWT issuer
	issuer, err := auth.NewJWTIssuer(cfg.JWT.KeyFile, cfg.JWT.Issuer, cfg.JWT.TokenTTL)
	if err != nil {
		slog.Error("initialising JWT issuer", "err", err)
		os.Exit(1)
	}
	slog.Info("JWT issuer ready", "issuer", cfg.JWT.Issuer)

	// Set up in-process queue
	q := inprocess.New()
	defer q.Close()

	// Set up TLS credentials
	creds, err := ingesttls.BuildServerCredentials(cfg.TLS.CertFile, cfg.TLS.KeyFile)
	if err != nil {
		slog.Error("building TLS credentials", "err", err)
		os.Exit(1)
	}

	// Build handlers
	regHandler := handlers.NewRegisterHandler(pool, issuer)
	versionPoller := config.NewVersionPoller(cfg.Agent.LatestVersion, 5*time.Minute)
	versionPoller.Start(ctx)
	terminalStore := handlers.NewTerminalStore()
	hbHandler := handlers.NewHeartbeatHandler(pool, issuer, q, versionPoller, cfg.Agent.DownloadBaseURL, terminalStore)
	terminalHandler := handlers.NewTerminalHandler(pool, issuer, terminalStore)
	terminalWSHandler := handlers.NewTerminalWSHandler(pool, terminalStore)
	inventoryHandler := handlers.NewInventoryHandler(pool, issuer)

	// Start JWKS HTTP server
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/.well-known/jwks.json", issuer.JWKSHandler())
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, "ok")
		})
		mux.Handle("/ws/terminal/", terminalWSHandler)
		addr := fmt.Sprintf(":%d", cfg.HTTPPort)
		slog.Info("JWKS HTTP server starting", "addr", addr)
		if err := http.ListenAndServe(addr, mux); err != nil && err != http.ErrServerClosed {
			slog.Error("JWKS server error", "err", err)
		}
	}()

	// Start cert expiry sweeper goroutine
	go handlers.RunCertExpirySweeper(ctx, pool, 15*time.Minute)

	// Start software inventory sweeper goroutine
	go handlers.RunSoftwareSweeper(ctx, pool)

	// Start gRPC server in goroutine
	grpcErr := make(chan error, 1)
	go func() {
		slog.Info("gRPC server starting", "port", cfg.GRPCPort)
		grpcErr <- ingestgrpc.Serve(ctx, cfg.GRPCPort, creds, regHandler, hbHandler, terminalHandler, inventoryHandler)
	}()

	select {
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	case err := <-grpcErr:
		if err != nil {
			slog.Error("gRPC server error", "err", err)
			os.Exit(1)
		}
	}

	slog.Info("ingest service shutdown complete")
}
