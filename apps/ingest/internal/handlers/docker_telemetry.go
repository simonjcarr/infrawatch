package handlers

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const maxDockerTelemetryPayloadBytes = 5 * 1024 * 1024

// SubmitDockerTelemetry receives Docker inventory batches from the agent.
// Metric sample ingestion is intentionally left for the Phase 3 sampler work.
func (h *InventoryHandler) SubmitDockerTelemetry(stream agentv1.IngestService_SubmitDockerTelemetryServer) error {
	ctx := stream.Context()
	agentID, err := h.authenticateDockerTelemetryStream(stream)
	if err != nil {
		return err
	}

	agent, err := queries.GetAgentByID(ctx, h.pool, agentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return status.Error(codes.NotFound, "agent not found")
		}
		slog.Error("docker telemetry: looking up agent", "agent_id", agentID, "err", err)
		return status.Error(codes.Internal, "internal error")
	}
	if agent.Status == "pending" || agent.Status == "revoked" {
		return status.Errorf(codes.PermissionDenied, "agent is not active (status: %s)", agent.Status)
	}

	hostID, err := queries.GetHostByAgentID(ctx, h.pool, agentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return status.Error(codes.NotFound, "host not found")
		}
		slog.Error("docker telemetry: resolving host", "agent_id", agentID, "err", err)
		return status.Error(codes.Internal, "internal error")
	}

	totalInventory := 0
	batches := 0
	lastBatchID := ""

	for {
		batch, recvErr := stream.Recv()
		if recvErr == io.EOF {
			if batches == 0 {
				return status.Error(codes.InvalidArgument, "stream closed before any Docker telemetry batch received")
			}
			return stream.SendAndClose(&agentv1.DockerTelemetryAck{
				Ok:                     true,
				BatchId:                lastBatchID,
				AcceptedInventoryCount: uint32(totalInventory),
				AcceptedSampleCount:    0,
			})
		}
		if recvErr != nil {
			return status.Errorf(codes.Internal, "receiving Docker telemetry batch: %v", recvErr)
		}
		if err := validateDockerTelemetryBatch(batch, agentID); err != nil {
			return err
		}

		now := time.Now()
		reports := queries.DockerContainerInventoryReportsFromProto(batch.Inventory, now)
		markMissing := batch.DroppedInventoryCount == 0
		if err := queries.SyncDockerContainerInventory(ctx, h.pool, agent.InstanceID, hostID, reports, now, markMissing); err != nil {
			slog.Error("docker telemetry: syncing container inventory", "host_id", hostID, "err", err)
			return status.Error(codes.Internal, "failed to persist Docker inventory")
		}

		totalInventory += len(reports)
		batches++
		lastBatchID = strings.TrimSpace(batch.BatchId)
	}
}

func (h *InventoryHandler) authenticateDockerTelemetryStream(stream agentv1.IngestService_SubmitDockerTelemetryServer) (string, error) {
	id, ok := pki.IdentityFromContext(stream.Context())
	if !ok || id == nil || id.AgentID == "" {
		return "", status.Error(codes.Unauthenticated, "missing client identity")
	}
	return id.AgentID, nil
}

func validateDockerTelemetryBatch(batch *agentv1.DockerTelemetryBatch, agentID string) error {
	if batch == nil {
		return status.Error(codes.InvalidArgument, "Docker telemetry batch is required")
	}
	if batch.AgentId != "" && batch.AgentId != agentID {
		return status.Error(codes.Unauthenticated, "client identity mismatch")
	}
	if batch.PayloadBytes > maxDockerTelemetryPayloadBytes {
		return status.Errorf(codes.InvalidArgument, "Docker telemetry payload exceeds maximum of %d bytes", maxDockerTelemetryPayloadBytes)
	}
	if len(batch.Inventory) > queries.MaxDockerInventoryItemsPerBatch {
		return status.Errorf(
			codes.InvalidArgument,
			"Docker inventory batch exceeds maximum of %d containers",
			queries.MaxDockerInventoryItemsPerBatch,
		)
	}
	if len(batch.Samples) > 0 {
		return status.Error(codes.Unimplemented, "Docker metric samples are not yet supported")
	}
	return nil
}
