package handlers

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/infrawatch/ingest/internal/auth"
	"github.com/infrawatch/ingest/internal/db/queries"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// InventoryHandler implements the SubmitSoftwareInventory client-streaming RPC.
type InventoryHandler struct {
	pool   *pgxpool.Pool
	issuer *auth.JWTIssuer
}

// NewInventoryHandler creates an InventoryHandler.
func NewInventoryHandler(pool *pgxpool.Pool, issuer *auth.JWTIssuer) *InventoryHandler {
	return &InventoryHandler{pool: pool, issuer: issuer}
}

// SubmitSoftwareInventory receives package chunks from the agent, upserts them
// into software_packages, and marks any previously-seen packages that are no
// longer present as removed when the final chunk arrives.
//
// Flow:
//  1. Authenticate agent via JWT in gRPC metadata (Authorization: Bearer <jwt>)
//  2. Validate the scan_id (task_run_hosts.id) belongs to this agent
//  3. Create a software_scans row (status=running)
//  4. For each chunk: upsert packages in a transaction
//  5. On is_last: mark removed packages, finalise software_scans, stamp host metadata
func (h *InventoryHandler) SubmitSoftwareInventory(stream agentv1.IngestService_SubmitSoftwareInventoryServer) error {
	ctx := stream.Context()

	// ── Auth ──────────────────────────────────────────────────────────────────
	agentID, err := h.authenticateStream(stream)
	if err != nil {
		return err
	}

	// ── Receive first chunk to get scan_id ────────────────────────────────────
	first, err := stream.Recv()
	if err == io.EOF {
		return status.Error(codes.InvalidArgument, "stream closed before any chunk received")
	}
	if err != nil {
		return status.Errorf(codes.Internal, "receiving first chunk: %v", err)
	}

	scanID := strings.TrimSpace(first.ScanId)
	if scanID == "" {
		return status.Error(codes.InvalidArgument, "scan_id is required")
	}
	source := strings.TrimSpace(first.Source)
	if source == "" {
		source = "other"
	}

	// ── Validate scan_id belongs to this agent ────────────────────────────────
	hostOrg, err := queries.GetHostOrgForTaskRunHost(ctx, h.pool, scanID, agentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return status.Errorf(codes.NotFound, "scan_id %s not found for agent %s", scanID, agentID)
		}
		slog.Error("inventory: looking up task run host", "scan_id", scanID, "err", err)
		return status.Error(codes.Internal, "internal error")
	}

	slog.Info("inventory: scan started", "scan_id", scanID, "agent_id", agentID, "host_id", hostOrg.HostID, "source", source)

	// ── Create software_scans row ─────────────────────────────────────────────
	startedAt := time.Now()
	softwareScanID, err := queries.InsertSoftwareScan(ctx, h.pool, hostOrg.OrgID, hostOrg.HostID, scanID, source, startedAt)
	if err != nil {
		slog.Error("inventory: creating software scan", "err", err)
		return status.Error(codes.Internal, "could not create scan record")
	}

	// Mark the task_run_hosts row as running (mirrors heartbeat handler).
	if err := queries.MarkTaskRunHostRunning(ctx, h.pool, scanID); err != nil {
		slog.Warn("inventory: marking task run host running", "scan_id", scanID, "err", err)
	}

	// ── Process chunks ────────────────────────────────────────────────────────
	totalReceived := 0
	totalAdded := 0

	processChunk := func(chunk *agentv1.SoftwareInventoryChunk) error {
		pkgs := chunk.Packages
		if len(pkgs) == 0 {
			return nil
		}

		names := make([]string, len(pkgs))
		versions := make([]string, len(pkgs))
		archs := make([]string, len(pkgs))
		publishers := make([]string, len(pkgs))
		installDates := make([]int64, len(pkgs))

		for i, p := range pkgs {
			names[i] = p.Name
			versions[i] = p.Version
			archs[i] = p.Architecture
			publishers[i] = p.Publisher
			installDates[i] = p.InstallDateUnix
		}

		added, err := queries.UpsertSoftwarePackagesBatch(
			ctx, h.pool,
			hostOrg.OrgID, hostOrg.HostID, source,
			names, versions, archs, publishers, installDates,
			time.Now(),
		)
		if err != nil {
			return err
		}
		totalReceived += len(pkgs)
		totalAdded += added
		return nil
	}

	// Process the first chunk.
	if err := processChunk(first); err != nil {
		slog.Error("inventory: upserting first chunk", "scan_id", scanID, "err", err)
		_ = queries.FailSoftwareScan(ctx, h.pool, softwareScanID, err.Error())
		return status.Error(codes.Internal, "failed to persist packages")
	}

	if first.IsLast {
		return h.finalise(ctx, softwareScanID, scanID, hostOrg.HostID, source, startedAt, totalReceived, totalAdded, stream)
	}

	// ── Receive remaining chunks ──────────────────────────────────────────────
	for {
		chunk, chunkErr := stream.Recv()
		if chunkErr == io.EOF {
			// Agent closed stream without sending is_last — treat as completion.
			break
		}
		if chunkErr != nil {
			slog.Error("inventory: receiving chunk", "scan_id", scanID, "err", chunkErr)
			_ = queries.FailSoftwareScan(ctx, h.pool, softwareScanID, chunkErr.Error())
			return status.Errorf(codes.Internal, "receiving chunk: %v", chunkErr)
		}

		if err := processChunk(chunk); err != nil {
			slog.Error("inventory: upserting chunk", "scan_id", scanID, "chunk", chunk.ChunkIndex, "err", err)
			_ = queries.FailSoftwareScan(ctx, h.pool, softwareScanID, err.Error())
			return status.Error(codes.Internal, "failed to persist packages")
		}

		if chunk.IsLast {
			return h.finalise(ctx, softwareScanID, scanID, hostOrg.HostID, source, startedAt, totalReceived, totalAdded, stream)
		}
	}

	return h.finalise(ctx, softwareScanID, scanID, hostOrg.HostID, source, startedAt, totalReceived, totalAdded, stream)
}

// finalise marks removed packages, completes the scan row, and sends the ack.
func (h *InventoryHandler) finalise(
	ctx context.Context,
	softwareScanID, taskRunHostID, hostID, source string,
	startedAt time.Time,
	totalReceived, totalAdded int,
	stream agentv1.IngestService_SubmitSoftwareInventoryServer,
) error {
	streamCtx := ctx

	// Mark packages not seen in this scan as removed.
	removed, err := queries.MarkRemovedPackages(streamCtx, h.pool, hostID, startedAt)
	if err != nil {
		slog.Warn("inventory: marking removed packages", "host_id", hostID, "err", err)
	}
	unchanged := totalReceived - totalAdded

	completedAt := time.Now()
	if err := queries.CompleteSoftwareScan(streamCtx, h.pool, softwareScanID,
		totalReceived, totalAdded, removed, unchanged, completedAt,
	); err != nil {
		slog.Warn("inventory: completing software scan", "scan_id", softwareScanID, "err", err)
	}

	// Stamp the host's lastSoftwareScanAt for the stale-scan banner.
	if err := queries.UpdateHostLastSoftwareScanAt(streamCtx, h.pool, hostID, completedAt); err != nil {
		slog.Warn("inventory: updating host lastSoftwareScanAt", "host_id", hostID, "err", err)
	}

	// Complete the task_run_hosts row.
	if err := queries.CompleteTaskRunHost(streamCtx, h.pool, taskRunHostID, "success", 0, "", ""); err != nil {
		slog.Warn("inventory: completing task run host", "task_run_host_id", taskRunHostID, "err", err)
	}
	if err := queries.MaybeCompleteTaskRun(streamCtx, h.pool, taskRunHostID); err != nil {
		slog.Warn("inventory: maybe completing task run", "task_run_host_id", taskRunHostID, "err", err)
	}

	slog.Info("inventory: scan complete",
		"scan_id", taskRunHostID,
		"host_id", hostID,
		"source", source,
		"received", totalReceived,
		"added", totalAdded,
		"removed", removed,
	)

	return stream.SendAndClose(&agentv1.SoftwareInventoryAck{Received: int32(totalReceived)})
}

// authenticateStream validates the agent JWT from gRPC metadata and returns
// the agent ID. Returns a gRPC status error on failure.
func (h *InventoryHandler) authenticateStream(stream agentv1.IngestService_SubmitSoftwareInventoryServer) (string, error) {
	ctx := stream.Context()
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "missing metadata")
	}
	authVals := md.Get("authorization")
	if len(authVals) == 0 {
		return "", status.Error(codes.Unauthenticated, "missing authorization header")
	}
	token := authVals[0]
	if len(token) > 7 && strings.EqualFold(token[:7], "bearer ") {
		token = token[7:]
	}
	agentID, _, err := h.issuer.ValidateAgentToken(token)
	if err != nil {
		return "", status.Error(codes.Unauthenticated, "invalid or expired token")
	}
	return agentID, nil
}
