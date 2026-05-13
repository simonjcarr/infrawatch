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
	"google.golang.org/protobuf/proto"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
	"github.com/carrtech-dev/ct-ops/ingest/internal/pki"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const maxDockerTelemetryPayloadBytes = 5 * 1024 * 1024

// SubmitDockerTelemetry receives Docker inventory and metric batches from the agent.
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
	totalSamples := 0
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
				AcceptedSampleCount:    uint32(totalSamples),
			})
		}
		if recvErr != nil {
			return status.Errorf(codes.Internal, "receiving Docker telemetry batch: %v", recvErr)
		}
		if err := validateDockerTelemetryBatch(batch, agentID); err != nil {
			return err
		}

		now := time.Now()
		recorded, err := queries.RecordDockerTelemetryBatch(ctx, h.pool, agent.InstanceID, hostID, agentID, batch, now)
		if err != nil {
			slog.Error("docker telemetry: recording batch", "host_id", hostID, "batch_id", batch.BatchId, "err", err)
			return status.Error(codes.Internal, "failed to record Docker telemetry batch")
		}
		if !recorded {
			batches++
			lastBatchID = strings.TrimSpace(batch.BatchId)
			continue
		}

		reports := queries.DockerContainerInventoryReportsFromProto(batch.Inventory, now)
		markMissing := batch.DroppedInventoryCount == 0
		if err := queries.SyncDockerContainerInventory(ctx, h.pool, agent.InstanceID, hostID, reports, now, markMissing); err != nil {
			slog.Error("docker telemetry: syncing container inventory", "host_id", hostID, "err", err)
			return status.Error(codes.Internal, "failed to persist Docker inventory")
		}
		metricReports := queries.DockerMetricReportsFromProto(batch.Samples, now)
		if err := queries.InsertDockerMetricReports(ctx, h.pool, agent.InstanceID, hostID, metricReports); err != nil {
			slog.Error("docker telemetry: inserting container metrics", "host_id", hostID, "err", err)
			return status.Error(codes.Internal, "failed to persist Docker metrics")
		}
		if len(reports) > 0 || len(metricReports) > 0 {
			evaluateDockerContainerAlerts(ctx, h.pool, agent.InstanceID, hostID, agent.Hostname, now)
		}

		totalInventory += len(reports)
		totalSamples += len(metricReports)
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
	if batch.PayloadBytes > maxDockerTelemetryPayloadBytes || proto.Size(batch) > maxDockerTelemetryPayloadBytes {
		return status.Errorf(codes.InvalidArgument, "Docker telemetry payload exceeds maximum of %d bytes", maxDockerTelemetryPayloadBytes)
	}
	if strings.TrimSpace(batch.BatchId) == "" && (len(batch.Inventory) > 0 || len(batch.Samples) > 0 || batch.DroppedSampleCount > 0 || batch.DroppedInventoryCount > 0) {
		return status.Error(codes.InvalidArgument, "Docker telemetry batch id is required")
	}
	if len(batch.Inventory) > queries.MaxDockerInventoryItemsPerBatch {
		return status.Errorf(
			codes.InvalidArgument,
			"Docker inventory batch exceeds maximum of %d containers",
			queries.MaxDockerInventoryItemsPerBatch,
		)
	}
	if len(batch.Samples) > queries.MaxDockerMetricSamplesPerBatch {
		return status.Errorf(
			codes.InvalidArgument,
			"Docker metric sample batch exceeds maximum of %d samples",
			queries.MaxDockerMetricSamplesPerBatch,
		)
	}
	now := time.Now()
	for _, sample := range batch.Samples {
		if sample == nil {
			continue
		}
		if !queries.DockerMetricTimestampInRange(sample.RecordedAtUnix, now) {
			return status.Error(codes.InvalidArgument, "Docker metric sample timestamp is outside the accepted range")
		}
	}
	return nil
}
