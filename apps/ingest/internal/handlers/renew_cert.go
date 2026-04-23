package handlers

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

// RenewCertHandler implements the RenewCertificate RPC.
type RenewCertHandler struct {
	pool *pgxpool.Pool
	ca   *pki.AgentCA
}

// NewRenewCertHandler creates a RenewCertHandler.
func NewRenewCertHandler(pool *pgxpool.Pool, ca *pki.AgentCA) *RenewCertHandler {
	return &RenewCertHandler{pool: pool, ca: ca}
}

// Renew signs a fresh CSR from an active agent whose current cert is still
// valid (enforced by the mTLS interceptor). The agent's SPIFFE identity in
// the verified client cert must match the requested agent_id.
func (h *RenewCertHandler) Renew(ctx context.Context, req *agentv1.RenewCertificateRequest) (*agentv1.RenewCertificateResponse, error) {
	if req.AgentId == "" || len(req.CsrDer) == 0 {
		return nil, status.Error(codes.InvalidArgument, "agent_id and csr_der are required")
	}
	identity, ok := pki.IdentityFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "mTLS identity not present on context")
	}
	if identity.AgentID != req.AgentId {
		slog.Warn("agent_id mismatch on renewal",
			"cert_agent_id", identity.AgentID, "req_agent_id", req.AgentId,
		)
		return nil, status.Error(codes.PermissionDenied, "cert SPIFFE identity does not match agent_id in request")
	}

	agent, err := queries.GetAgentByID(ctx, h.pool, req.AgentId)
	if err != nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	if agent.Status != "active" {
		return nil, status.Errorf(codes.PermissionDenied, "agent status is %s", agent.Status)
	}

	leaf, err := h.ca.Sign(req.CsrDer, req.AgentId, agent.OrganisationID)
	if err != nil {
		slog.Error("signing renewal CSR", "agent_id", req.AgentId, "err", err)
		return nil, status.Error(codes.Internal, "signing failed")
	}

	if _, err := h.pool.Exec(ctx, `
		UPDATE agents
		   SET client_cert_pem = $1,
		       client_cert_serial = $2,
		       client_cert_issued_at = NOW(),
		       client_cert_not_after = $3,
		       updated_at = NOW()
		 WHERE id = $4`,
		string(leaf.PEM), leaf.Serial, leaf.NotAfter, req.AgentId,
	); err != nil {
		slog.Error("persisting renewed cert", "agent_id", req.AgentId, "err", err)
		return nil, status.Error(codes.Internal, "persisting cert failed")
	}

	slog.Info("renewed agent client cert",
		"agent_id", req.AgentId, "serial", leaf.Serial, "not_after", leaf.NotAfter,
	)
	return &agentv1.RenewCertificateResponse{
		ClientCertPem:          string(leaf.PEM),
		ClientCertNotAfterUnix: leaf.NotAfter.Unix(),
		AgentCaCertPem:         string(h.ca.CertPEM),
	}, nil
}

// Silence context import if nothing else uses it (pre-compile safety).
var _ = context.Background
