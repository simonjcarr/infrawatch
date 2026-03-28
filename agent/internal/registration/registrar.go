package registration

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"runtime"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"

	"github.com/infrawatch/agent/internal/identity"
)

const pollInterval = 30 * time.Second

// Registrar handles the agent registration lifecycle.
type Registrar struct {
	client   agentv1.IngestServiceClient
	keypair  *identity.Keypair
	orgToken string
	version  string
}

// New creates a new Registrar.
func New(client agentv1.IngestServiceClient, keypair *identity.Keypair, orgToken, version string) *Registrar {
	return &Registrar{
		client:   client,
		keypair:  keypair,
		orgToken: orgToken,
		version:  version,
	}
}

// Register calls the ingest service Register RPC.
// If the response status is "pending", it polls until the agent becomes
// "active" or the context is cancelled.
// Returns the final agent state once active.
func (r *Registrar) Register(ctx context.Context, existingAgentID string) (*identity.AgentState, error) {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	req := &agentv1.RegisterRequest{
		OrgToken:  r.orgToken,
		PublicKey: r.keypair.PublicKeyPEM,
		PlatformInfo: &agentv1.PlatformInfo{
			Os:   runtime.GOOS,
			Arch: runtime.GOARCH,
		},
		AgentInfo: &agentv1.AgentInfo{
			AgentId:  existingAgentID,
			Version:  r.version,
			Hostname: hostname,
		},
	}

	for {
		resp, err := r.client.Register(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("register RPC: %w", err)
		}

		slog.Info("registration response", "status", resp.Status, "agent_id", resp.AgentId, "message", resp.Message)

		switch resp.Status {
		case "active":
			return &identity.AgentState{
				AgentID:  resp.AgentId,
				JWTToken: resp.JwtToken,
			}, nil

		case "pending":
			slog.Info("agent pending approval, polling", "interval", pollInterval)
			// Update agent_id in subsequent requests (idempotent re-registration)
			req.AgentInfo.AgentId = resp.AgentId
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(pollInterval):
				// continue loop
			}

		case "revoked":
			return nil, fmt.Errorf("agent has been revoked: %s", resp.Message)

		default:
			return nil, fmt.Errorf("unexpected registration status %q: %s", resp.Status, resp.Message)
		}
	}
}
