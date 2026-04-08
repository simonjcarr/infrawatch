package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"google.golang.org/grpc"

	agentgrpc "github.com/infrawatch/agent/internal/grpc"
	"github.com/infrawatch/agent/internal/checks"
	"github.com/infrawatch/agent/internal/config"
	"github.com/infrawatch/agent/internal/heartbeat"
	"github.com/infrawatch/agent/internal/identity"
	"github.com/infrawatch/agent/internal/install"
	"github.com/infrawatch/agent/internal/registration"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// version is injected at build time via -ldflags "-X main.version=<tag>".
var version = "dev"

func main() {
	configPath := flag.String("config", "/etc/infrawatch/agent.toml", "Path to agent TOML config file")
	tokenFlag := flag.String("token", "", "Enrolment token (overrides config file and INFRAWATCH_ORG_TOKEN)")
	addressFlag := flag.String("address", "", "Ingest address host:port (overrides config file and INFRAWATCH_INGEST_ADDRESS)")
	installFlag := flag.Bool("install", false, "Install agent as a system service and exit (requires --token)")
	tlsSkipVerifyFlag := flag.Bool("tls-skip-verify", false, "Skip TLS certificate verification — use when ingest uses a self-signed cert (insecure)")
	versionFlag := flag.Bool("version", false, "Print agent version and exit")
	versionFlagShort := flag.Bool("v", false, "Print agent version and exit (shorthand)")
	flag.Parse()

	if *versionFlag || *versionFlagShort {
		fmt.Printf("infrawatch-agent %s\n", version)
		os.Exit(0)
	}

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	// ── Install mode: self-install as a system service, then exit ─────────────
	if *installFlag {
		if *tokenFlag == "" {
			slog.Error("--token is required when using --install")
			os.Exit(1)
		}
		if err := install.Run(*tokenFlag, strings.TrimSpace(*addressFlag), *tlsSkipVerifyFlag); err != nil {
			slog.Error("install failed", "err", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	// ── Normal agent mode ──────────────────────────────────────────────────────
	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("loading config", "err", err)
		os.Exit(1)
	}

	if *tokenFlag != "" {
		cfg.Agent.OrgToken = strings.TrimSpace(*tokenFlag)
	}
	if *addressFlag != "" {
		cfg.Ingest.Address = strings.TrimSpace(*addressFlag)
	}
	if *tlsSkipVerifyFlag {
		cfg.Ingest.TLSSkipVerify = true
	}

	if cfg.Agent.OrgToken == "" {
		slog.Error("org_token is required in config or INFRAWATCH_ORG_TOKEN environment variable")
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := runService(ctx, cancel, func(ctx context.Context) error {
		return runAgent(ctx, cfg)
	}); err != nil && err != context.Canceled {
		slog.Error("agent error", "err", err)
		os.Exit(1)
	}

	slog.Info("agent shutdown complete")
}

func runAgent(ctx context.Context, cfg *config.Config) error {
	keypair, err := identity.LoadOrGenerate(cfg.Agent.DataDir)
	if err != nil {
		return err
	}
	slog.Info("agent identity ready", "data_dir", cfg.Agent.DataDir)

	state, err := identity.LoadState(cfg.Agent.DataDir)
	if err != nil {
		return err
	}

	// dialFunc creates a fresh gRPC connection each time it is called. The
	// heartbeat runner calls it once per stream attempt so that a stuck or
	// stale ClientConn from a previous attempt can never block reconnection.
	dialFunc := func() (*grpc.ClientConn, error) {
		return agentgrpc.Connect(cfg.Ingest.Address, cfg.Ingest.CACertFile, cfg.Ingest.TLSSkipVerify)
	}

	if state.JWTToken == "" {
		slog.Info("registering agent", "address", cfg.Ingest.Address)
		regConn, err := dialFunc()
		if err != nil {
			slog.Error("connecting to ingest service", "err", err, "address", cfg.Ingest.Address)
			return err
		}
		registrar := registration.New(agentv1.NewIngestServiceClient(regConn), keypair, cfg.Agent.OrgToken, version)
		newState, err := registrar.Register(ctx, state.AgentID)
		regConn.Close()
		if err != nil {
			return err
		}
		state = newState
		if err := identity.SaveState(cfg.Agent.DataDir, state); err != nil {
			return err
		}
		slog.Info("agent registered and active", "agent_id", state.AgentID)
	} else {
		slog.Info("agent already registered", "agent_id", state.AgentID)
	}

	slog.Info("starting heartbeat", "interval_secs", cfg.Agent.HeartbeatIntervalSecs, "version", version)
	executor := checks.NewExecutor()
	hb := heartbeat.New(dialFunc, state.AgentID, state.JWTToken, version, cfg.Agent.HeartbeatIntervalSecs, executor)
	return hb.Run(ctx)
}
