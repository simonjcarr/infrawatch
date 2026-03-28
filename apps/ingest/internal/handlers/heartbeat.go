package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/infrawatch/ingest/internal/auth"
	"github.com/infrawatch/ingest/internal/db/queries"
	"github.com/infrawatch/ingest/internal/queue"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// HeartbeatHandler implements the Heartbeat streaming RPC.
type HeartbeatHandler struct {
	pool      *pgxpool.Pool
	issuer    *auth.JWTIssuer
	publisher queue.Publisher
}

// NewHeartbeatHandler creates a HeartbeatHandler.
func NewHeartbeatHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer, pub queue.Publisher) *HeartbeatHandler {
	return &HeartbeatHandler{pool: pool, issuer: issuer, publisher: pub}
}

// Heartbeat handles the bidirectional heartbeat stream.
//
// Flow:
//  1. Validate JWT on first message
//  2. Verify agent is active in DB
//  3. Loop: update heartbeat timestamp + host vitals, publish to queue
//  4. On stream close: set agent status to offline
func (h *HeartbeatHandler) Heartbeat(stream agentv1.IngestService_HeartbeatServer) error {
	ctx := stream.Context()

	// Receive first message to authenticate
	first, err := stream.Recv()
	if err == io.EOF {
		return nil
	}
	if err != nil {
		return status.Errorf(codes.Internal, "receiving first heartbeat: %v", err)
	}

	// Validate JWT
	agentID, orgID, err := h.issuer.ValidateAgentToken(first.AgentId)
	if err != nil {
		// AgentId field carries the JWT token for authentication on first message
		// If that fails, try treating it as an agent ID (backwards compat)
		agentID = first.AgentId
		if agentID == "" {
			return status.Error(codes.Unauthenticated, "invalid or missing JWT")
		}
		slog.Debug("JWT validation failed, using agent_id directly", "agent_id", agentID, "err", err)
		orgID = ""
	}
	_ = orgID

	// Verify agent is active
	agent, err := queries.GetAgentByID(ctx, h.pool, agentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return status.Error(codes.NotFound, "agent not found")
		}
		return status.Error(codes.Internal, "internal error")
	}
	if agent.Status != "active" {
		return status.Errorf(codes.PermissionDenied, "agent is not active (status: %s)", agent.Status)
	}

	slog.Info("heartbeat stream started", "agent_id", agentID)

	// Process first message
	if err := h.processHeartbeat(ctx, stream, agentID, agent.OrganisationID, first); err != nil {
		return err
	}

	// Stream loop
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			slog.Warn("heartbeat recv error", "agent_id", agentID, "err", err)
			break
		}

		if err := h.processHeartbeat(ctx, stream, agentID, agent.OrganisationID, req); err != nil {
			return err
		}
	}

	// Mark agent offline on stream close
	if err := queries.SetAgentStatus(context.Background(), h.pool, agentID, "offline"); err != nil {
		slog.Warn("setting agent offline", "err", err)
	}
	if err := queries.InsertAgentStatusHistory(context.Background(), h.pool, agentID, agent.OrganisationID, "offline", nil, "heartbeat stream closed"); err != nil {
		slog.Warn("inserting offline status history", "err", err)
	}

	slog.Info("heartbeat stream ended, agent marked offline", "agent_id", agentID)
	return nil
}

func (h *HeartbeatHandler) processHeartbeat(
	ctx context.Context,
	stream agentv1.IngestService_HeartbeatServer,
	agentID, orgID string,
	req *agentv1.HeartbeatRequest,
) error {
	now := time.Now()

	// Update DB
	if err := queries.UpdateAgentHeartbeat(ctx, h.pool, agentID, now); err != nil {
		slog.Warn("updating agent heartbeat", "err", err)
	}

	if err := queries.UpdateHostVitals(ctx, h.pool, agentID,
		req.CpuPercent, req.MemoryPercent, req.DiskPercent,
		req.UptimeSeconds, nil,
	); err != nil {
		slog.Warn("updating host vitals", "err", err)
	}

	// Publish to queue
	payload, _ := json.Marshal(map[string]interface{}{
		"agent_id":  agentID,
		"org_id":    orgID,
		"timestamp": now.Unix(),
		"cpu":       req.CpuPercent,
		"memory":    req.MemoryPercent,
		"disk":      req.DiskPercent,
		"uptime":    req.UptimeSeconds,
	})
	if err := h.publisher.Publish(queue.Message{Topic: queue.TopicMetricsRaw, Payload: payload}); err != nil {
		slog.Warn("publishing metric to queue", "err", err)
	}

	return stream.Send(&agentv1.HeartbeatResponse{Ok: true})
}
