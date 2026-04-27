package main

import (
	"context"
	"crypto/x509"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/carrtech-dev/ct-ops/ingest/internal/auth"
	"github.com/carrtech-dev/ct-ops/ingest/internal/config"
	"github.com/carrtech-dev/ct-ops/ingest/internal/db"
	ingestgrpc "github.com/carrtech-dev/ct-ops/ingest/internal/grpc"
	"github.com/carrtech-dev/ct-ops/ingest/internal/handlers"
	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
	"github.com/carrtech-dev/ct-ops/ingest/internal/queue/inprocess"
	ingesttls "github.com/carrtech-dev/ct-ops/ingest/internal/tls"
)

func main() {
	configPath := flag.String("config", "/etc/ct-ops/ingest.yaml", "Path to ingest YAML config file")
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
	issuer, err := auth.NewJWTIssuer(pool, cfg.JWT.KeyFile, cfg.JWT.Issuer, cfg.JWT.TokenTTL)
	if err != nil {
		slog.Error("initialising JWT issuer", "err", err)
		os.Exit(1)
	}
	slog.Info("JWT issuer ready", "issuer", cfg.JWT.Issuer)

	// Load or generate the agent CA (signs per-agent client certs).
	agentCA, err := pki.LoadOrCreate(ctx, pool, cfg.TLS.AgentCACertFile, cfg.TLS.AgentCAKeyFile)
	if err != nil {
		slog.Error("initialising agent CA", "err", err)
		os.Exit(1)
	}

	// Load the browser-facing nginx TLS cert used by agents for self-update
	// download verification. Refreshes every 30s so an operator swap is
	// picked up without restarting ingest. When no path is configured the
	// loader returns an empty value and the rotation RPC is a no-op.
	webServerCert, err := pki.LoadWebServerCert(cfg.TLS.WebServerCertFile)
	if err != nil {
		slog.Warn("loading web server cert — rotation RPC disabled", "err", err)
		webServerCert, _ = pki.LoadWebServerCert("")
	}
	go webServerCert.Run(ctx.Done(), 30*time.Second)

	// Revocation set — in-memory; refreshed from DB on interval.
	revocation, err := pki.NewRevocation(ctx, pool)
	if err != nil {
		slog.Error("initialising revocation set", "err", err)
		os.Exit(1)
	}
	go revocation.Run(ctx, 5*time.Second)

	// Set up in-process queue
	q := inprocess.New()
	defer q.Close()

	// Set up TLS credentials (mTLS with the agent CA as the client trust pool).
	creds, err := ingesttls.BuildServerCredentials(
		cfg.TLS.CertFile,
		cfg.TLS.KeyFile,
		agentCA.TrustPool(),
		func(chains [][]*x509.Certificate) error {
			if _, _, err := pki.VerifyLeaf(chains, revocation); err != nil {
				return err
			}
			return nil
		},
	)
	if err != nil {
		slog.Error("building TLS credentials", "err", err)
		os.Exit(1)
	}

	// Build handlers
	regHandler := handlers.NewRegisterHandler(pool, issuer, agentCA)
	versionPoller := config.NewVersionPoller(cfg.Agent.LatestVersion, 5*time.Minute)
	versionPoller.Start(ctx)
	hbHandler := handlers.NewHeartbeatHandler(pool, issuer, q, versionPoller, cfg.Agent.DownloadBaseURL, agentCA, webServerCert)
	terminalWSHandler := handlers.NewTerminalWSHandler(pool)
	inventoryHandler := handlers.NewInventoryHandler(pool, issuer)
	renewHandler := handlers.NewRenewCertHandler(pool, agentCA)

	// Start the CSR sweeper so admin-approved agents get their certs signed.
	go pki.RunCSRSweeper(ctx, pool, agentCA, 5*time.Second)

	// Start JWKS HTTP server
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/.well-known/jwks.json", issuer.JWKSHandler())
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, "ok")
		})
		mux.Handle("/ws/terminal/", terminalWSHandler)
		addr := fmt.Sprintf(":%d", cfg.HTTPPort)
		// Explicit Server so we can set ReadHeaderTimeout — without it a slow
		// client can hold a connection open indefinitely while dribbling
		// header bytes (gosec G114, "Slowloris"). Read/Write/IdleTimeout are
		// intentionally left at zero: the same mux serves the
		// /ws/terminal/ WebSocket upgrade, whose post-upgrade connections
		// must stay open for the lifetime of the terminal session.
		srv := &http.Server{
			Addr:              addr,
			Handler:           mux,
			ReadHeaderTimeout: 10 * time.Second,
		}
		slog.Info("JWKS HTTP server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("JWKS server error", "err", err)
		}
	}()

	// Start cert expiry sweeper goroutine
	go handlers.RunCertExpirySweeper(ctx, pool, 15*time.Minute)

	// Start software inventory sweeper goroutine
	go handlers.RunSoftwareSweeper(ctx, pool)

	// Start cert URL refresh sweeper goroutine
	go handlers.RunCertRefreshSweeper(ctx, pool, 60*time.Second)

	// Start task schedule sweeper goroutine
	go handlers.RunTaskScheduleSweeper(ctx, pool, 30*time.Second)

	// Start gRPC server in goroutine
	grpcErr := make(chan error, 1)
	go func() {
		slog.Info("gRPC server starting", "port", cfg.GRPCPort)
		grpcErr <- ingestgrpc.Serve(ctx, cfg.GRPCPort, creds, regHandler, hbHandler, inventoryHandler, renewHandler)
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
