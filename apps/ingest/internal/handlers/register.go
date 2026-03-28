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
//  3. Insert agent (status=pending) + host row
//  4. If auto_approve on token → set active, issue JWT
//  5. Return RegisterResponse
func (h *RegisterHandler) Register(ctx context.Context, req *agentv1.RegisterRequest) (*agentv1.RegisterResponse, error) {
	if req.OrgToken == "" || req.PublicKey == "" {
		return nil, status.Error(codes.InvalidArgument, "org_token and public_key are required")
	}

	hostname := "unknown"
	if req.AgentInfo != nil && req.AgentInfo.Hostname != "" {
		hostname = req.AgentInfo.Hostname
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

	// Step 3: Insert new agent
	agentStatus := "pending"
	agentID, err := queries.InsertAgent(ctx, h.pool, orgID, hostname, req.PublicKey, agentStatus, token.ID)
	if err != nil {
		slog.Error("inserting agent", "err", err)
		return nil, status.Error(codes.Internal, "failed to register agent")
	}

	if err := queries.IncrementUsageCount(ctx, h.pool, token.ID); err != nil {
		slog.Warn("incrementing enrolment token usage", "err", err)
	}

	// Insert host row
	if _, err := queries.InsertHost(ctx, h.pool, orgID, agentID, hostname); err != nil {
		slog.Warn("inserting host row", "err", err)
	}

	// Append status history
	if err := queries.InsertAgentStatusHistory(ctx, h.pool, agentID, orgID, "pending", nil, "initial registration"); err != nil {
		slog.Warn("inserting status history", "err", err)
	}

	slog.Info("agent registered", "agent_id", agentID, "hostname", hostname, "auto_approve", token.AutoApprove)

	// Step 4: Auto-approve if configured
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

	// Step 5: Pending — waiting for admin approval
	return &agentv1.RegisterResponse{
		AgentId: agentID,
		Status:  "pending",
		Message: "agent registered and awaiting admin approval",
	}, nil
}
