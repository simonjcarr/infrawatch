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
	pool            *pgxpool.Pool
	issuer          *auth.JWTIssuer
	publisher       queue.Publisher
	latestVersion   string
	downloadBaseURL string
}

// NewHeartbeatHandler creates a HeartbeatHandler.
func NewHeartbeatHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer, pub queue.Publisher, latestVersion, downloadBaseURL string) *HeartbeatHandler {
	return &HeartbeatHandler{
		pool:            pool,
		issuer:          issuer,
		publisher:       pub,
		latestVersion:   latestVersion,
		downloadBaseURL: downloadBaseURL,
	}
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
	agentID, _, err := h.issuer.ValidateAgentToken(first.AgentId)
	if err != nil {
		// AgentId field carries the JWT token for authentication on first message
		// If that fails, try treating it as an agent ID (backwards compat)
		agentID = first.AgentId
		if agentID == "" {
			return status.Error(codes.Unauthenticated, "invalid or missing JWT")
		}
		slog.Debug("JWT validation failed, using agent_id directly", "agent_id", agentID, "err", err)
	}

	// Verify agent is active
	agent, err := queries.GetAgentByID(ctx, h.pool, agentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return status.Error(codes.NotFound, "agent not found")
		}
		return status.Error(codes.Internal, "internal error")
	}
	// Allow offline agents to reconnect — offline is a transient state set when
	// a stream closes. Only pending and revoked agents should be blocked.
	if agent.Status == "pending" || agent.Status == "revoked" {
		return status.Errorf(codes.PermissionDenied, "agent is not active (status: %s)", agent.Status)
	}
	if agent.Status == "offline" {
		if err := queries.SetAgentStatus(ctx, h.pool, agentID, "active"); err != nil {
			slog.Warn("reactivating offline agent", "err", err)
		}
		if err := queries.InsertAgentStatusHistory(ctx, h.pool, agentID, agent.OrganisationID, "active", nil, "agent reconnected"); err != nil {
			slog.Warn("inserting reconnect status history", "err", err)
		}
		agent.Status = "active"
	}

	// Resolve host ID once for the lifetime of this stream
	hostID, err := queries.GetHostByAgentID(ctx, h.pool, agentID)
	if err != nil {
		slog.Warn("resolving host for agent", "agent_id", agentID, "err", err)
		hostID = ""
	}

	slog.Info("heartbeat stream started", "agent_id", agentID)

	// Process first message
	if err := h.processHeartbeat(ctx, stream, agentID, agent.OrganisationID, hostID, first); err != nil {
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

		if err := h.processHeartbeat(ctx, stream, agentID, agent.OrganisationID, hostID, req); err != nil {
			return err
		}
	}

	// Mark agent and host offline on stream close
	if err := queries.SetAgentStatus(context.Background(), h.pool, agentID, "offline"); err != nil {
		slog.Warn("setting agent offline", "err", err)
	}
	if err := queries.SetHostOffline(context.Background(), h.pool, agentID); err != nil {
		slog.Warn("setting host offline", "err", err)
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
	agentID, orgID, hostID string,
	req *agentv1.HeartbeatRequest,
) error {
	now := time.Now()

	// Update DB
	if err := queries.UpdateAgentHeartbeat(ctx, h.pool, agentID, now, req.AgentVersion); err != nil {
		slog.Warn("updating agent heartbeat", "err", err)
	}

	// Extract IP addresses from network interfaces
	var ipAddresses []string
	for _, iface := range req.NetworkInterfaces {
		ipAddresses = append(ipAddresses, iface.IpAddresses...)
	}

	disksJSON := marshalJSON(req.Disks)
	netJSON := marshalJSON(req.NetworkInterfaces)

	if err := queries.UpdateHostVitals(ctx, h.pool, agentID,
		req.CpuPercent, req.MemoryPercent, req.DiskPercent,
		req.UptimeSeconds, ipAddresses,
		req.OsVersion, req.Os, req.Arch, disksJSON, netJSON,
	); err != nil {
		slog.Warn("updating host vitals", "err", err)
	}

	// Persist metric history row
	if err := queries.InsertHostMetricByAgentID(ctx, h.pool, orgID, agentID, now,
		req.CpuPercent, req.MemoryPercent, req.DiskPercent, req.UptimeSeconds,
	); err != nil {
		slog.Warn("inserting host metric", "err", err)
	}

	// Persist incoming check results
	if hostID != "" {
		for _, result := range req.CheckResults {
			ranAt := time.Unix(result.RanAtUnix, 0)
			if err := queries.InsertCheckResult(ctx, h.pool,
				result.CheckID, hostID, orgID,
				result.Status, result.Output,
				result.DurationMs, ranAt,
			); err != nil {
				slog.Warn("inserting check result", "check_id", result.CheckID, "err", err)
			}
		}
	}

	// Publish to queue (for consumers/metrics in standard/ha deployments)
	payload, _ := json.Marshal(map[string]interface{}{
		"agent_id":      agentID,
		"org_id":        orgID,
		"timestamp":     now.Unix(),
		"cpu":           req.CpuPercent,
		"memory":        req.MemoryPercent,
		"disk":          req.DiskPercent,
		"uptime":        req.UptimeSeconds,
		"agent_version": req.AgentVersion,
		"os_version":    req.OsVersion,
	})
	if err := h.publisher.Publish(queue.Message{Topic: queue.TopicMetricsRaw, Payload: payload}); err != nil {
		slog.Warn("publishing metric to queue", "err", err)
	}

	resp := &agentv1.HeartbeatResponse{Ok: true}

	// Signal an update when the agent is running a different version than the
	// configured latest, and the agent is not a dev build.
	if h.latestVersion != "" &&
		req.AgentVersion != "" &&
		req.AgentVersion != "dev" &&
		req.AgentVersion != h.latestVersion {
		resp.UpdateAvailable = true
		resp.LatestVersion = h.latestVersion
		resp.DownloadURL = h.downloadBaseURL + "/api/agent/download"
		slog.Info("signalling agent update",
			"agent_id", agentID,
			"current", req.AgentVersion,
			"latest", h.latestVersion,
		)
	}

	// Push active check definitions to the agent
	if hostID != "" {
		checkRows, err := queries.GetChecksForHost(ctx, h.pool, hostID)
		if err != nil {
			slog.Warn("fetching checks for host", "host_id", hostID, "err", err)
		} else {
			defs := make([]agentv1.CheckDefinition, 0, len(checkRows))
			for _, row := range checkRows {
				defs = append(defs, agentv1.CheckDefinition{
					CheckID:         row.ID,
					CheckType:       row.CheckType,
					ConfigJSON:      row.ConfigJSON,
					IntervalSeconds: int32(row.IntervalSeconds),
				})
			}
			resp.Checks = defs
		}
	}

	return stream.Send(resp)
}

// marshalJSON encodes v as a JSON string, returning "[]" on error.
func marshalJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}
