package handlers

import (
	"context"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/infrawatch/ingest/internal/auth"
	"github.com/infrawatch/ingest/internal/db/queries"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// RegisterHandler implements the Register RPC.
type RegisterHandler struct {
	pool   *pgxpool.Pool
	issuer *auth.JWTIssuer
}

// NewRegisterHandler creates a RegisterHandler.
func NewRegisterHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer) *RegisterHandler {
	return &RegisterHandler{pool: pool, issuer: issuer}
}

// Register handles agent registration.
//
// Flow:
//  1. Validate org_token → UNAUTHENTICATED if invalid/expired
//  2. Check if public_key already registered → return existing state (idempotent)
//  3. Check for a colliding host (same hostname or overlapping IP) in the org:
//     - Online match → reject with ALREADY_EXISTS (two live hosts can't share identity)
//     - Offline/unknown match → adopt: rotate public key onto the existing agent row
//  4. Insert agent (status=pending) + host row
//  5. If auto_approve on token → set active, issue JWT
//  6. Return RegisterResponse
func (h *RegisterHandler) Register(ctx context.Context, req *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error) {
	if req.OrgToken == "" || req.PublicKey == "" {
		return nil, status.Error(codes.InvalidArgument, "org_token and public_key are required")
	}

	hostname := "unknown"
	if req.AgentInfo != nil && req.AgentInfo.Hostname != "" {
		hostname = req.AgentInfo.Hostname
	}

	var reportedIPs []string
	if req.PlatformInfo != nil {
		reportedIPs = req.PlatformInfo.IpAddresses
	}

	// Step 1: Validate enrolment token
	token, err := queries.GetEnrolmentToken(ctx, h.pool, req.OrgToken)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, status.Error(codes.Unauthenticated, "invalid or expired enrolment token")
		}
		slog.Error("looking up enrolment token", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	orgID := token.OrganisationID

	// Step 2: Check for existing registration (idempotent)
	existing, err := queries.GetAgentByPublicKey(ctx, h.pool, req.PublicKey)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("looking up agent by public key", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}

	if existing != nil {
		slog.Info("agent already registered", "agent_id", existing.ID, "status", existing.Status)
		if existing.Status == "active" {
			jwtToken, err := h.issuer.IssueAgentToken(existing.ID, orgID)
			if err != nil {
				slog.Error("issuing JWT for existing agent", "err", err)
				return nil, status.Error(codes.Internal, "internal error")
			}
			return &agentv1.RegisterResponse{
				AgentId:  existing.ID,
				Status:   "active",
				Message:  "agent already registered and active",
				JwtToken: jwtToken,
			}, nil
		}
		return &agentv1.RegisterResponse{
			AgentId: existing.ID,
			Status:  existing.Status,
			Message: "agent already registered, status: " + existing.Status,
		}, nil
	}

	var agentOS, agentArch string
	if req.PlatformInfo != nil {
		agentOS = req.PlatformInfo.Os
		agentArch = req.PlatformInfo.Arch
	}

	// Step 3: Check for identity collision with an existing host in the org.
	// Hostname or IP overlap indicates the same physical machine — either
	// actively duplicating (reject) or re-registering after a data-dir wipe
	// (adopt the existing row to avoid stale duplicate records).
	collision, err := queries.FindHostCollision(ctx, h.pool, orgID, hostname, reportedIPs)
	if err != nil {
		slog.Error("checking host collision", "err", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	if collision != nil {
		// An active/online match means a live agent is still heartbeating under
		// a different keypair. The network can't hold two machines with the same
		// hostname/IP, so this is an error — delete the existing host first.
		if collision.HostStatus == "online" || collision.AgentStatus == "active" || collision.AgentStatus == "revoked" {
			reason := "online duplicate"
			if collision.AgentStatus == "revoked" {
				reason = "existing agent revoked"
			}
			slog.Warn("rejecting registration due to host collision",
				"hostname", hostname,
				"existing_host_id", collision.HostID,
				"existing_agent_id", collision.AgentID,
				"existing_host_status", collision.HostStatus,
				"existing_agent_status", collision.AgentStatus,
				"reason", reason,
			)
			return nil, status.Errorf(codes.AlreadyExists,
				"a host matching this hostname or IP is already registered in this organisation (%s) — delete the existing host before re-registering",
				reason,
			)
		}

		// Offline or unknown: treat as a re-registration of the same machine.
		// Rotate the public key onto the existing agent row and reuse the host.
		if collision.AgentID == "" {
			slog.Warn("host collision has no linked agent; falling through to fresh insert",
				"host_id", collision.HostID)
		} else {
			if err := queries.RotateAgentPublicKey(ctx, h.pool, collision.AgentID, req.PublicKey); err != nil {
				slog.Error("rotating public key on adopted agent", "err", err)
				return nil, status.Error(codes.Internal, "failed to adopt existing registration")
			}
			if err := queries.ReattachHostToAgent(ctx, h.pool, collision.HostID, collision.AgentID, hostname); err != nil {
				slog.Warn("reattaching host during adoption", "err", err)
			}
			if err := queries.InsertAgentStatusHistory(ctx, h.pool, collision.AgentID, orgID, collision.AgentStatus, nil,
				"adopted re-registration (keypair rotated; matched by hostname or IP)"); err != nil {
				slog.Warn("inserting adoption history", "err", err)
			}
			if err := queries.IncrementUsageCount(ctx, h.pool, token.ID); err != nil {
				slog.Warn("incrementing enrolment token usage", "err", err)
			}
			slog.Info("adopted existing host for re-registering agent",
				"agent_id", collision.AgentID,
				"host_id", collision.HostID,
				"hostname", hostname,
				"prior_status", collision.AgentStatus,
			)
			// Preserve prior approval state. If the existing agent was active
			// before going offline, return active + JWT immediately so the
			// machine resumes without requiring re-approval.
			if collision.AgentStatus == "active" {
				jwtToken, err := h.issuer.IssueAgentToken(collision.AgentID, orgID)
				if err != nil {
					slog.Error("issuing JWT for adopted agent", "err", err)
					return nil, status.Error(codes.Internal, "internal error")
				}
				return &agentv1.RegisterResponse{
					AgentId:  collision.AgentID,
					Status:   "active",
					Message:  "re-registration adopted existing host; resumed active state",
					JwtToken: jwtToken,
				}, nil
			}
			return &agentv1.RegisterResponse{
				AgentId: collision.AgentID,
				Status:  collision.AgentStatus,
				Message: "re-registration adopted existing host; status: " + collision.AgentStatus,
			}, nil
		}
	}

	// Step 4: Insert new agent
	agentStatus := "pending"
	agentID, err := queries.InsertAgent(ctx, h.pool, orgID, hostname, req.PublicKey, agentStatus, token.ID, agentOS, agentArch)
	if err != nil {
		slog.Error("inserting agent", "err", err)
		return nil, status.Error(codes.Internal, "failed to register agent")
	}

	if err := queries.IncrementUsageCount(ctx, h.pool, token.ID); err != nil {
		slog.Warn("incrementing enrolment token usage", "err", err)
	}

	// Insert host row
	if _, err := queries.InsertHost(ctx, h.pool, orgID, agentID, hostname, agentOS, agentArch); err != nil {
		slog.Warn("inserting host row", "err", err)
	}

	// Append status history
	if err := queries.InsertAgentStatusHistory(ctx, h.pool, agentID, orgID, "pending", nil, "initial registration"); err != nil {
		slog.Warn("inserting status history", "err", err)
	}

	slog.Info("agent registered", "agent_id", agentID, "hostname", hostname, "auto_approve", token.AutoApprove)

	// Step 5: Auto-approve if configured
	if token.AutoApprove {
		if err := queries.ApproveAgent(ctx, h.pool, agentID); err != nil {
			slog.Error("auto-approving agent", "err", err)
			return nil, status.Error(codes.Internal, "internal error")
		}
		if err := queries.InsertAgentStatusHistory(ctx, h.pool, agentID, orgID, "active", nil, "auto-approved by enrolment token"); err != nil {
			slog.Warn("inserting auto-approve history", "err", err)
		}

		jwtToken, err := h.issuer.IssueAgentToken(agentID, orgID)
		if err != nil {
			slog.Error("issuing JWT for auto-approved agent", "err", err)
			return nil, status.Error(codes.Internal, "internal error")
		}

		slog.Info("agent auto-approved", "agent_id", agentID)
		return &agentv1.RegisterResponse{
			AgentId:  agentID,
			Status:   "active",
			Message:  "agent registered and auto-approved",
			JwtToken: jwtToken,
		}, nil
	}

	// Step 6: Pending — waiting for admin approval
	return &agentv1.RegisterResponse{
		AgentId: agentID,
		Status:  "pending",
		Message: "agent registered and awaiting admin approval",
	}, nil
}
