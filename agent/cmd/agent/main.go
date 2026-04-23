package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"google.golang.org/grpc"

	agentgrpc "github.com/carrtech-dev/ct-ops/agent/internal/grpc"
	"github.com/carrtech-dev/ct-ops/agent/internal/checks"
	"github.com/carrtech-dev/ct-ops/agent/internal/config"
	"github.com/carrtech-dev/ct-ops/agent/internal/heartbeat"
	"github.com/carrtech-dev/ct-ops/agent/internal/identity"
	"github.com/carrtech-dev/ct-ops/agent/internal/install"
	"github.com/carrtech-dev/ct-ops/agent/internal/registration"
	"github.com/carrtech-dev/ct-ops/agent/internal/tasks"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

// version is injected at build time via -ldflags "-X main.version=<tag>".
var version = "dev"

// sliceFlag collects repeatable string flags (e.g. "--tag env=prod --tag team=platform").
type sliceFlag []string

func (s *sliceFlag) String() string { return strings.Join(*s, ",") }

func (s *sliceFlag) Set(v string) error {
	*s = append(*s, v)
	return nil
}

// parseTagPair splits "key=value" or "key:value" into its components. Leading
// or trailing whitespace is trimmed. Empty keys or values are rejected.
func parseTagPair(raw string) (string, string, error) {
	sep := strings.IndexAny(raw, "=:")
	if sep < 0 {
		return "", "", fmt.Errorf("tag %q must be key=value or key:value", raw)
	}
	k := strings.TrimSpace(raw[:sep])
	v := strings.TrimSpace(raw[sep+1:])
	if k == "" || v == "" {
		return "", "", fmt.Errorf("tag %q has empty key or value", raw)
	}
	return k, v, nil
}

// mergeTags merges config tags and CLI tags, last-wins on key conflict. CLI
// tags are passed last so the operator's most-specific intent overrides what
// was baked into the bundle.
func mergeTags(layers ...[]string) []*agentv1.Tag {
	byKey := map[string]string{}
	order := []string{}
	for _, layer := range layers {
		for _, raw := range layer {
			k, v, err := parseTagPair(raw)
			if err != nil {
				slog.Warn("ignoring invalid tag", "raw", raw, "err", err)
				continue
			}
			lk := strings.ToLower(k)
			if _, seen := byKey[lk]; !seen {
				order = append(order, lk)
			}
			byKey[lk] = k + "\x00" + v
		}
	}
	out := make([]*agentv1.Tag, 0, len(order))
	for _, lk := range order {
		kv := byKey[lk]
		parts := strings.SplitN(kv, "\x00", 2)
		out = append(out, &agentv1.Tag{Key: parts[0], Value: parts[1]})
	}
	return out
}

func main() {
	configPath := flag.String("config", "/etc/ct-ops/agent.toml", "Path to agent TOML config file")
	tokenFlag := flag.String("token", "", "Enrolment token (overrides config file and CT_OPS_ORG_TOKEN)")
	addressFlag := flag.String("address", "", "Ingest address host:port (overrides config file and CT_OPS_INGEST_ADDRESS)")
	installFlag := flag.Bool("install", false, "Install agent as a system service and exit (requires --token)")
	uninstallFlag := flag.Bool("uninstall", false, "Stop and remove the agent service, binary, config, and data files")
	tlsSkipVerifyFlag := flag.Bool("tls-skip-verify", false, "Skip TLS certificate verification — use when ingest uses a self-signed cert (insecure)")
	versionFlag := flag.Bool("version", false, "Print agent version and exit")
	versionFlagShort := flag.Bool("v", false, "Print agent version and exit (shorthand)")
	var tagFlags sliceFlag
	flag.Var(&tagFlags, "tag", "Tag to apply at registration as key=value or key:value (repeatable)")
	flag.Parse()

	if *versionFlag || *versionFlagShort {
		fmt.Printf("ct-ops-agent %s\n", version)
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
		if err := install.Run(*tokenFlag, strings.TrimSpace(*addressFlag), *tlsSkipVerifyFlag, []string(tagFlags)); err != nil {
			slog.Error("install failed", "err", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	// ── Uninstall mode: stop service, remove all agent files, then exit ───────
	if *uninstallFlag {
		if err := install.Uninstall(); err != nil {
			slog.Error("uninstall failed", "err", err)
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
		slog.Error("org_token is required in config or CT_OPS_ORG_TOKEN environment variable")
		os.Exit(1)
	}

	mergedTags := mergeTags(cfg.Agent.Tags, []string(tagFlags))

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := runService(ctx, cancel, func(ctx context.Context) error {
		return runAgent(ctx, cfg, mergedTags)
	}); err != nil && err != context.Canceled {
		slog.Error("agent error", "err", err)
		os.Exit(1)
	}

	slog.Info("agent shutdown complete")
}

func runAgent(ctx context.Context, cfg *config.Config, tags []*agentv1.Tag) error {
	keypair, err := identity.LoadOrGenerate(cfg.Agent.DataDir)
	if err != nil {
		return err
	}
	slog.Info("agent identity ready", "data_dir", cfg.Agent.DataDir)

	// dialFunc creates a fresh gRPC connection each time it is called. The
	// heartbeat runner calls it once per stream attempt so that a stuck or
	// stale ClientConn from a previous attempt can never block reconnection.
	// The client certificate is re-read from disk on every dial so rotation
	// picks up the latest cert after the heartbeat loop has persisted it.
	dialFunc := func() (*grpc.ClientConn, error) {
		clientCert, err := keypair.TLSCertificate(cfg.Agent.DataDir)
		if err != nil {
			slog.Warn("loading client cert for mTLS", "err", err)
		}
		return agentgrpc.Connect(cfg.Ingest.Address, cfg.Ingest.CACertFile, cfg.Ingest.TLSSkipVerify, clientCert)
	}

	// Inject dial function into the tasks package so the software_inventory
	// handler can open its own streaming gRPC connection.
	tasks.SetDialFunc(dialFunc)

	executor := checks.NewExecutor()

	for {
		state, err := identity.LoadState(cfg.Agent.DataDir)
		if err != nil {
			return err
		}

		if state.JWTToken == "" {
			slog.Info("registering agent", "address", cfg.Ingest.Address)
			regConn, err := dialFunc()
			if err != nil {
				slog.Error("connecting to ingest service", "err", err, "address", cfg.Ingest.Address)
				return err
			}
			registrar := registration.New(agentv1.NewIngestServiceClient(regConn), keypair, cfg.Agent.OrgToken, version, tags, cfg.Agent.DataDir)
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

		// Keep the tasks package updated with the current agent identity so
		// the software_inventory handler can auth its stream.
		tasks.SetAgentID(state.AgentID)
		tasks.SetJWTToken(state.JWTToken)

		slog.Info("starting heartbeat", "interval_secs", cfg.Agent.HeartbeatIntervalSecs, "version", version)
		hb := heartbeat.New(dialFunc, state.AgentID, state.JWTToken, version, cfg.Agent.HeartbeatIntervalSecs, executor, cfg.Agent.DataDir, keypair)
		err = hb.Run(ctx)

		if errors.Is(err, heartbeat.ErrAgentDeregistered) {
			// Server rejected this agent — clear local state so the next loop
			// iteration triggers a fresh registration with the same keypair.
			slog.Warn("agent deregistered by server, clearing state and re-registering")
			if clearErr := identity.SaveState(cfg.Agent.DataDir, &identity.AgentState{}); clearErr != nil {
				slog.Error("clearing agent state", "err", clearErr)
				return clearErr
			}
			continue
		}

		return err
	}
}
