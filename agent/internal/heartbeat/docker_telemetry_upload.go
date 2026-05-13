package heartbeat

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"google.golang.org/protobuf/proto"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	defaultDockerTelemetryMaxBatchBytes      = 5 * 1024 * 1024
	defaultDockerTelemetryMaxSamplesPerBatch = 5000
	dockerTelemetryUploadTimeout             = 20 * time.Second
)

type dockerTelemetryLimits struct {
	maxSamplesPerBatch   int
	maxInventoryPerBatch int
	maxBatchBytes        int
	maxLabelBytes        int
	enabled              bool
}

func defaultDockerTelemetryLimits() dockerTelemetryLimits {
	return dockerTelemetryLimits{
		maxSamplesPerBatch:   defaultDockerTelemetryMaxSamplesPerBatch,
		maxInventoryPerBatch: MaxDockerInventoryItemsPerBatch,
		maxBatchBytes:        defaultDockerTelemetryMaxBatchBytes,
		maxLabelBytes:        defaultMaxDockerLabelBytes,
		enabled:              true,
	}
}

func dockerTelemetryLimitsFromConfig(config *agentv1.DockerTelemetryConfig) dockerTelemetryLimits {
	limits := defaultDockerTelemetryLimits()
	if config == nil {
		return limits
	}
	limits.enabled = config.Enabled
	if config.MaxSamplesPerBatch > 0 {
		limits.maxSamplesPerBatch = int(config.MaxSamplesPerBatch)
	}
	if config.MaxInventoryItemsPerBatch > 0 {
		limits.maxInventoryPerBatch = int(config.MaxInventoryItemsPerBatch)
	}
	if config.MaxBatchBytes > 0 {
		limits.maxBatchBytes = int(config.MaxBatchBytes)
	}
	if config.MaxLabelBytesPerContainer > 0 {
		limits.maxLabelBytes = int(config.MaxLabelBytesPerContainer)
	}
	return limits
}

func buildDockerTelemetryBatches(
	agentID string,
	startSequence uint32,
	inventory []*agentv1.DockerContainerInventory,
	samples []*agentv1.DockerContainerMetricSample,
	droppedSamples uint32,
	limits dockerTelemetryLimits,
) []*agentv1.DockerTelemetryBatch {
	if limits.maxSamplesPerBatch <= 0 {
		limits.maxSamplesPerBatch = defaultDockerTelemetryMaxSamplesPerBatch
	}
	if limits.maxInventoryPerBatch <= 0 {
		limits.maxInventoryPerBatch = MaxDockerInventoryItemsPerBatch
	}
	if limits.maxBatchBytes <= 0 {
		limits.maxBatchBytes = defaultDockerTelemetryMaxBatchBytes
	}

	flushedAt := time.Now().Unix()
	sequence := startSequence
	var batches []*agentv1.DockerTelemetryBatch
	for len(inventory) > 0 || len(samples) > 0 || (len(batches) == 0 && droppedSamples > 0) {
		batch := &agentv1.DockerTelemetryBatch{
			AgentId:            agentID,
			BatchId:            fmt.Sprintf("%s-%d-%d", agentID, flushedAt, sequence),
			FlushedAtUnix:      flushedAt,
			Sequence:           sequence,
			DroppedSampleCount: droppedSamples,
		}
		droppedSamples = 0

		for len(inventory) > 0 && len(batch.Inventory) < limits.maxInventoryPerBatch {
			candidate := cloneDockerTelemetryBatch(batch)
			candidate.Inventory = append(candidate.Inventory, inventory[0])
			setDockerTelemetryPayloadBytes(candidate)
			if len(batch.Inventory) > 0 && int(candidate.PayloadBytes) > limits.maxBatchBytes {
				break
			}
			batch = candidate
			inventory = inventory[1:]
			if int(batch.PayloadBytes) >= limits.maxBatchBytes {
				break
			}
		}

		for len(inventory) == 0 && len(samples) > 0 && len(batch.Samples) < limits.maxSamplesPerBatch {
			candidate := cloneDockerTelemetryBatch(batch)
			candidate.Samples = append(candidate.Samples, samples[0])
			setDockerTelemetryPayloadBytes(candidate)
			if len(batch.Samples)+len(batch.Inventory) > 0 && int(candidate.PayloadBytes) > limits.maxBatchBytes {
				break
			}
			batch = candidate
			samples = samples[1:]
			if int(batch.PayloadBytes) >= limits.maxBatchBytes {
				break
			}
		}

		if len(batch.Inventory) == 0 && len(batch.Samples) == 0 && len(inventory) > 0 {
			batch.Inventory = append(batch.Inventory, inventory[0])
			inventory = inventory[1:]
		}
		if len(batch.Inventory) == 0 && len(batch.Samples) == 0 && len(samples) > 0 {
			batch.Samples = append(batch.Samples, samples[0])
			samples = samples[1:]
		}
		setDockerTelemetryPayloadBytes(batch)
		batches = append(batches, batch)
		sequence++
	}
	return batches
}

func cloneDockerTelemetryBatch(batch *agentv1.DockerTelemetryBatch) *agentv1.DockerTelemetryBatch {
	clone := *batch
	clone.Inventory = append([]*agentv1.DockerContainerInventory(nil), batch.Inventory...)
	clone.Samples = append([]*agentv1.DockerContainerMetricSample(nil), batch.Samples...)
	return &clone
}

func setDockerTelemetryPayloadBytes(batch *agentv1.DockerTelemetryBatch) {
	var previous uint32
	for {
		size := uint32(proto.Size(batch))
		batch.PayloadBytes = size
		if size == previous {
			return
		}
		previous = size
	}
}

func (r *Runner) flushDockerTelemetry(ctx context.Context, client agentv1.IngestServiceClient) {
	limits := r.currentDockerTelemetryLimits()
	if !limits.enabled {
		return
	}

	samples, dropped := r.drainDockerMetricSamples()
	inventory, err := collectDockerInventory(ctx, defaultDockerSocketPath, limits.maxLabelBytes)
	if err != nil {
		slog.Debug("collecting Docker inventory for telemetry upload", "err", err)
	}
	if len(inventory) == 0 && len(samples) == 0 && dropped == 0 {
		return
	}

	startSequence := r.nextDockerTelemetrySequence()
	batches := buildDockerTelemetryBatches(r.agentID, startSequence, inventory, samples, dropped, limits)
	if len(batches) == 0 {
		return
	}
	if err := r.sendDockerTelemetryBatches(ctx, client, batches); err != nil {
		slog.Warn("uploading Docker telemetry", "err", err, "batches", len(batches), "samples", len(samples))
		r.dockerMetricBuffer.Add(samples)
		return
	}
	r.advanceDockerTelemetrySequence(uint32(len(batches)))
}

func (r *Runner) sendDockerTelemetryBatches(ctx context.Context, client agentv1.IngestServiceClient, batches []*agentv1.DockerTelemetryBatch) error {
	uploadCtx, cancel := context.WithTimeout(ctx, dockerTelemetryUploadTimeout)
	defer cancel()

	stream, err := client.SubmitDockerTelemetry(uploadCtx)
	if err != nil {
		return fmt.Errorf("opening Docker telemetry stream: %w", err)
	}
	for _, batch := range batches {
		if err := stream.Send(batch); err != nil {
			_ = stream.CloseSend()
			return fmt.Errorf("sending Docker telemetry batch: %w", err)
		}
	}
	ack, err := stream.CloseAndRecv()
	if err != nil {
		return fmt.Errorf("receiving Docker telemetry ack: %w", err)
	}
	if ack == nil || !ack.Ok {
		if ack != nil && ack.Error != "" {
			return fmt.Errorf("Docker telemetry rejected: %s", ack.Error)
		}
		return fmt.Errorf("Docker telemetry rejected")
	}
	return nil
}
