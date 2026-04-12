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
	"github.com/infrawatch/ingest/internal/config"
	"github.com/infrawatch/ingest/internal/db/queries"
	"github.com/infrawatch/ingest/internal/queue"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// HeartbeatHandler implements the Heartbeat streaming RPC.
type HeartbeatHandler struct {
	pool            *pgxpool.Pool
	issuer          *auth.JWTIssuer
	publisher       queue.Publisher
	versionPoller   *config.VersionPoller
	downloadBaseURL string
	terminalStore   *TerminalStore
}

// NewHeartbeatHandler creates a HeartbeatHandler.
func NewHeartbeatHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer, pub queue.Publisher, versionPoller *config.VersionPoller, downloadBaseURL string, terminalStore *TerminalStore) *HeartbeatHandler {
	return &HeartbeatHandler{
		pool:            pool,
		issuer:          issuer,
		publisher:       pub,
		versionPoller:   versionPoller,
		downloadBaseURL: downloadBaseURL,
		terminalStore:   terminalStore,
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
	if err := h.processHeartbeat(ctx, stream, agentID, agent.OrganisationID, hostID, agent.Hostname, first); err != nil {
		return err
	}

	// Background receiver: pushes incoming HeartbeatRequests onto recvCh so
	// the main loop can also select on the query-poll ticker.
	recvCh := make(chan *agentv1.HeartbeatRequest, 4)
	recvErrCh := make(chan error, 1)
	go func() {
		for {
			req, err := stream.Recv()
			if err != nil {
				recvErrCh <- err
				close(recvCh)
				return
			}
			select {
			case recvCh <- req:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Poll the DB every 2s for pending ad-hoc queries to push proactively.
	// This is the key to sub-5-second user-facing latency for "Query server".
	queryPollTicker := time.NewTicker(2 * time.Second)
	defer queryPollTicker.Stop()

	// Re-validate the agent exists every 30s. If it was deleted (e.g. the host
	// was removed in the UI), close the stream with NotFound so the agent
	// detects the rejection and re-registers cleanly rather than heartbeating
	// into the void for the lifetime of the stream.
	agentCheckTicker := time.NewTicker(30 * time.Second)
	defer agentCheckTicker.Stop()

	// Scan for task_run_hosts rows that have been 'running' for more than
	// 60 minutes with no completion signal. This catches cases where the agent
	// dies mid-task or a bug prevents the result from being reported.
	taskTimeoutTicker := time.NewTicker(5 * time.Minute)
	defer taskTimeoutTicker.Stop()

loop:
	for {
		select {
		case <-ctx.Done():
			break loop

		case err := <-recvErrCh:
			if err == io.EOF || ctx.Err() != nil {
				break loop
			}
			slog.Warn("heartbeat recv error", "agent_id", agentID, "err", err)
			break loop

		case req, ok := <-recvCh:
			if !ok {
				break loop
			}
			if hostID == "" {
				if id, retryErr := queries.GetHostByAgentID(ctx, h.pool, agentID); retryErr == nil {
					hostID = id
					slog.Info("resolved host after retry", "agent_id", agentID, "host_id", hostID)
				}
			}
			if err := h.processHeartbeat(ctx, stream, agentID, agent.OrganisationID, hostID, agent.Hostname, req); err != nil {
				return err
			}

		case <-taskTimeoutTicker.C:
			if err := queries.TimeoutStuckTaskRunHosts(ctx, h.pool, 60*time.Minute); err != nil {
				slog.Warn("timing out stuck task run hosts", "err", err)
			}

		case <-agentCheckTicker.C:
			if _, err := queries.GetAgentByID(ctx, h.pool, agentID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					slog.Info("agent deleted, closing stream for re-registration", "agent_id", agentID)
					return status.Error(codes.NotFound, "agent not found")
				}
				slog.Warn("re-validating agent", "agent_id", agentID, "err", err)
			}

		case <-queryPollTicker.C:
			if hostID == "" {
				if id, retryErr := queries.GetHostByAgentID(ctx, h.pool, agentID); retryErr == nil {
					hostID = id
					slog.Info("resolved host after retry", "agent_id", agentID, "host_id", hostID)
				} else {
					continue
				}
			}
			pending, err := queries.GetPendingQueriesForHost(ctx, h.pool, hostID)
			if err != nil {
				slog.Warn("fetching pending queries", "host_id", hostID, "err", err)
			} else if len(pending) > 0 {
				pqs := make([]*agentv1.AgentQuery, 0, len(pending))
				for _, p := range pending {
					pqs = append(pqs, &agentv1.AgentQuery{QueryId: p.ID, QueryType: p.QueryType})
				}
				if err := stream.Send(&agentv1.HeartbeatResponse{Ok: true, PendingQueries: pqs}); err != nil {
					slog.Warn("pushing pending queries", "host_id", hostID, "err", err)
					return err
				}
				slog.Info("pushed pending queries to agent", "host_id", hostID, "count", len(pqs))
			}

			// Dispatch the next eligible task (parallelism enforced in SQL).
			pendingTasks, taskErr := queries.GetPendingTasksForHost(ctx, h.pool, hostID)
			if taskErr != nil {
				slog.Warn("fetching pending tasks", "host_id", hostID, "err", taskErr)
			} else if len(pendingTasks) > 0 {
				t := pendingTasks[0]
				if err := queries.MarkTaskRunHostRunning(ctx, h.pool, t.ID); err != nil {
					slog.Warn("marking task run host running", "task_run_host_id", t.ID, "err", err)
				} else if err := stream.Send(&agentv1.HeartbeatResponse{
					Ok: true,
					PendingTask: &agentv1.AgentTask{
						TaskId:     t.ID,
						TaskType:   t.TaskType,
						ConfigJson: t.ConfigJSON,
					},
				}); err != nil {
					slog.Warn("pushing pending task to agent", "task_run_host_id", t.ID, "err", err)
					return err
				} else {
					slog.Info("dispatched task to agent", "host_id", hostID, "task_run_host_id", t.ID, "task_type", t.TaskType)
				}
			}

			// Send cancellation signals for any tasks the user has stopped.
			cancelIDs, cancelErr := queries.GetCancellingTasksForHost(ctx, h.pool, hostID)
			if cancelErr != nil {
				slog.Warn("fetching cancelling tasks", "host_id", hostID, "err", cancelErr)
			} else if len(cancelIDs) > 0 {
				if err := stream.Send(&agentv1.HeartbeatResponse{
					Ok:            true,
					CancelTaskIds: cancelIDs,
				}); err != nil {
					slog.Warn("pushing cancel task IDs to agent", "host_id", hostID, "err", err)
					return err
				}
				slog.Info("pushed cancel task IDs to agent", "host_id", hostID, "count", len(cancelIDs))
			}

			// Push pending terminal sessions to the agent.
			if h.terminalStore != nil {
				pendingSessions, tsErr := queries.GetPendingTerminalSessionsForHost(ctx, h.pool, hostID)
				if tsErr != nil {
					slog.Warn("fetching pending terminal sessions", "host_id", hostID, "err", tsErr)
				} else if len(pendingSessions) > 0 {
					if err := stream.Send(&agentv1.HeartbeatResponse{
						Ok:                      true,
						PendingTerminalSessions: pendingSessions,
					}); err != nil {
						slog.Warn("pushing terminal sessions to agent", "host_id", hostID, "err", err)
						return err
					}
					for _, ps := range pendingSessions {
						if sess, ok := h.terminalStore.Get(ps.SessionId); ok {
							sess.incrementPushCount()
						}
					}
					slog.Info("pushed pending terminal sessions to agent", "host_id", hostID, "count", len(pendingSessions))
				}
			}
		}
	}

	// Mark agent and host offline on stream close
	if err := queries.SetAgentStatus(context.Background(), h.pool, agentID, "offline"); err != nil {
		slog.Warn("setting agent offline", "err", err)
	}
	if err := queries.SetHostOffline(context.Background(), h.pool, agentID); err != nil {
		slog.Warn("setting host offline", "err", err)
	}
	// Clean up any in-flight terminal sessions for this host
	if hostID != "" {
		if err := queries.CleanupTerminalSessionsForHost(context.Background(), h.pool, hostID); err != nil {
			slog.Warn("cleaning up terminal sessions for host", "host_id", hostID, "err", err)
		}
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
	agentID, orgID, hostID, hostname string,
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
		// Build a checkID → checkType map once per heartbeat to route cert results.
		checkTypeMap := make(map[string]string)
		if hostChecks, err := queries.GetChecksForHost(ctx, h.pool, hostID); err == nil {
			for _, c := range hostChecks {
				checkTypeMap[c.ID] = c.CheckType
			}
		} else {
			slog.Warn("heartbeat: fetching check types for host", "host_id", hostID, "err", err)
		}

		for _, result := range req.CheckResults {
			ranAt := time.Unix(result.RanAtUnix, 0)
			if err := queries.InsertCheckResult(ctx, h.pool,
				result.CheckId, hostID, orgID,
				result.Status, result.Output,
				result.DurationMs, ranAt,
			); err != nil {
				slog.Warn("inserting check result", "check_id", result.CheckId, "err", err)
			}

			// Dispatch type-specific results to their persisters.
			switch checkTypeMap[result.CheckId] {
			case "certificate":
				if result.Output != "" {
					persistCertificateResult(ctx, h.pool, orgID, hostID, result.CheckId, result.Output)
				}
			case "service_account":
				if result.Output != "" {
					persistServiceAccountResult(ctx, h.pool, orgID, hostID, result.CheckId, result.Output)
				}
			case "ssh_key_scan":
				if result.Output != "" {
					persistSshKeyResult(ctx, h.pool, orgID, hostID, result.CheckId, result.Output)
				}
			}
		}

		// Evaluate alert rules for this heartbeat.
		checkStatuses := make(map[string]string, len(req.CheckResults))
		for _, result := range req.CheckResults {
			checkStatuses[result.CheckId] = result.Status
		}
		evaluateAlerts(ctx, h.pool, orgID, hostID, hostname, checkStatuses, heartbeatMetrics{
			CPU:    req.CpuPercent,
			Memory: req.MemoryPercent,
			Disk:   req.DiskPercent,
		})
	}

	// Persist incoming ad-hoc agent query results
	for _, qr := range req.QueryResults {
		var resultJSON []byte
		switch qr.QueryType {
		case "list_ports":
			resultJSON, _ = json.Marshal(map[string]any{"ports": qr.Ports})
		case "list_services":
			resultJSON, _ = json.Marshal(map[string]any{"services": qr.Services})
		}
		// The agent uses "ok"/"error"; normalise to the DB values "complete"/"error".
		dbStatus := qr.Status
		if dbStatus == "ok" {
			dbStatus = "complete"
		}
		if err := queries.CompleteAgentQuery(ctx, h.pool, qr.QueryId, dbStatus, qr.Error, resultJSON); err != nil {
			slog.Warn("completing agent query", "query_id", qr.QueryId, "err", err)
		}
	}

	// Persist incremental task output chunks
	for _, p := range req.TaskProgress {
		if err := queries.AppendTaskOutput(ctx, h.pool, p.TaskId, p.OutputChunk); err != nil {
			slog.Warn("appending task output", "task_run_host_id", p.TaskId, "err", err)
		}
	}

	// Persist task completions
	for _, tr := range req.TaskResults {
		hostStatus := "success"
		if tr.ExitCode != 0 {
			hostStatus = "failed"
		}
		if err := queries.CompleteTaskRunHost(ctx, h.pool, tr.TaskId, hostStatus,
			int(tr.ExitCode), tr.ResultJson, tr.Error,
		); err != nil {
			slog.Warn("completing task run host", "task_run_host_id", tr.TaskId, "err", err)
			continue
		}
		if err := queries.MaybeCompleteTaskRun(ctx, h.pool, tr.TaskId); err != nil {
			slog.Warn("maybe completing task run", "task_run_host_id", tr.TaskId, "err", err)
		}
		slog.Info("task completed on agent", "task_run_host_id", tr.TaskId, "status", hostStatus, "exit_code", tr.ExitCode)
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
	// latest known version, and the agent is not a dev build.
	// latestVersion is read from the poller so it refreshes without a restart.
	latestVersion := h.versionPoller.Get()
	if latestVersion != "" &&
		req.AgentVersion != "" &&
		req.AgentVersion != "dev" &&
		req.AgentVersion != latestVersion {
		resp.UpdateAvailable = true
		resp.LatestVersion = latestVersion
		resp.DownloadUrl = h.downloadBaseURL + "/api/agent/download"
		slog.Info("signalling agent update",
			"agent_id", agentID,
			"current", req.AgentVersion,
			"latest", latestVersion,
		)
	}

	// Push active check definitions to the agent
	if hostID != "" {
		checkRows, err := queries.GetChecksForHost(ctx, h.pool, hostID)
		if err != nil {
			slog.Warn("fetching checks for host", "host_id", hostID, "err", err)
		} else {
			defs := make([]*agentv1.CheckDefinition, 0, len(checkRows))
			for _, row := range checkRows {
				defs = append(defs, &agentv1.CheckDefinition{
					CheckId:         row.ID,
					CheckType:       row.CheckType,
					ConfigJson:      row.ConfigJSON,
					IntervalSeconds: int32(row.IntervalSeconds),
				})
			}
			resp.Checks = defs
		}

		// Also include pending terminal sessions in every heartbeat response.
		// This is redundant with the queryPollTicker push but ensures the agent
		// sees terminal sessions even if the poll ticker is delayed.
		if h.terminalStore != nil {
			pendingSessions, tsErr := queries.GetPendingTerminalSessionsForHost(ctx, h.pool, hostID)
			if tsErr != nil {
				slog.Warn("fetching terminal sessions in heartbeat response", "host_id", hostID, "err", tsErr)
			} else if len(pendingSessions) > 0 {
				resp.PendingTerminalSessions = pendingSessions
				for _, ps := range pendingSessions {
					if sess, ok := h.terminalStore.Get(ps.SessionId); ok {
						sess.incrementPushCount()
					}
				}
				slog.Info("including terminal sessions in heartbeat response", "host_id", hostID, "count", len(pendingSessions))
			}
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
