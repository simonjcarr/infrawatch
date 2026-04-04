package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	agentgrpc "github.com/infrawatch/agent/internal/grpc"
	"github.com/infrawatch/agent/internal/config"
	"github.com/infrawatch/agent/internal/heartbeat"
	"github.com/infrawatch/agent/internal/identity"
	"github.com/infrawatch/agent/internal/registration"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// version is injected at build time via -ldflags "-X main.version=<tag>".
var version = "dev"

func main() {
	configPath := flag.String("config", "/etc/infrawatch/agent.toml", "Path to agent TOML config file")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("loading config", "err", err)
		os.Exit(1)
	}

	if cfg.Agent.OrgToken == "" {
		slog.Error("org_token is required in config or INFRAWATCH_ORG_TOKEN environment variable")
		os.Exit(1)
	}

	// Load or generate identity keypair
	keypair, err := identity.LoadOrGenerate(cfg.Agent.DataDir)
	if err != nil {
		slog.Error("loading agent keypair", "err", err)
		os.Exit(1)
	}
	slog.Info("agent identity ready", "data_dir", cfg.Agent.DataDir)

	// Load persisted state (agent ID + JWT from prior registration)
	state, err := identity.LoadState(cfg.Agent.DataDir)
	if err != nil {
		slog.Error("loading agent state", "err", err)
		os.Exit(1)
	}

	// Build gRPC connection
	conn, err := agentgrpc.Connect(cfg.Ingest.Address, cfg.Ingest.CACertFile)
	if err != nil {
		slog.Error("connecting to ingest service", "err", err, "address", cfg.Ingest.Address)
		os.Exit(1)
	}
	defer conn.Close()

	client := agentv1.NewIngestServiceClient(conn)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Register if not already active
	if state.JWTToken == "" {
		slog.Info("registering agent", "address", cfg.Ingest.Address)
		registrar := registration.New(client, keypair, cfg.Agent.OrgToken, version)
		newState, err := registrar.Register(ctx, state.AgentID)
		if err != nil {
			slog.Error("registration failed", "err", err)
			os.Exit(1)
		}
		state = newState
		if err := identity.SaveState(cfg.Agent.DataDir, state); err != nil {
			slog.Error("saving agent state", "err", err)
			os.Exit(1)
		}
		slog.Info("agent registered and active", "agent_id", state.AgentID)
	} else {
		slog.Info("agent already registered", "agent_id", state.AgentID)
	}

	// Start heartbeat loop
	slog.Info("starting heartbeat", "interval_secs", cfg.Agent.HeartbeatIntervalSecs, "version", version)
	hb := heartbeat.New(client, state.AgentID, state.JWTToken, version, cfg.Agent.HeartbeatIntervalSecs)
	if err := hb.Run(ctx); err != nil && err != context.Canceled {
		slog.Error("heartbeat error", "err", err)
		os.Exit(1)
	}

	slog.Info("agent shutdown complete")
}
