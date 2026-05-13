package queries

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	MaxDockerMetricSamplesPerBatch = 5000

	maxDockerMetricFutureSkew = 5 * time.Minute
	maxDockerMetricPastAge    = 35 * 24 * time.Hour
)

type DockerMetricReport struct {
	DockerContainerID string
	RecordedAt        time.Time
	CPUPercent        float64
	MemoryUsageBytes  int64
	MemoryLimitBytes  int64
	MemoryPercent     float64
	NetworkRXBytes    int64
	NetworkTXBytes    int64
	BlockReadBytes    int64
	BlockWriteBytes   int64
	PidsCurrent       int32
	RestartCount      int32
}

func DockerMetricReportsFromProto(items []*agentv1.DockerContainerMetricSample, receivedAt time.Time) []DockerMetricReport {
	reports := make([]DockerMetricReport, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		containerID := truncateUTF8(strings.TrimSpace(item.DockerContainerId), maxDockerContainerIDBytes)
		if containerID == "" {
			continue
		}
		reports = append(reports, DockerMetricReport{
			DockerContainerID: containerID,
			RecordedAt:        dockerMetricRecordedAt(item.RecordedAtUnix, receivedAt),
			CPUPercent:        clampPercent(item.CpuPercent),
			MemoryUsageBytes:  uint64ToInt64(item.MemoryUsageBytes),
			MemoryLimitBytes:  uint64ToInt64(item.MemoryLimitBytes),
			MemoryPercent:     clampPercent(item.MemoryPercent),
			NetworkRXBytes:    uint64ToInt64(item.NetworkRxBytes),
			NetworkTXBytes:    uint64ToInt64(item.NetworkTxBytes),
			BlockReadBytes:    uint64ToInt64(item.BlockReadBytes),
			BlockWriteBytes:   uint64ToInt64(item.BlockWriteBytes),
			PidsCurrent:       uint32ToInt32(item.PidsCurrent),
			RestartCount:      item.RestartCount,
		})
	}
	return reports
}

func InsertDockerMetricReports(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID string, reports []DockerMetricReport) error {
	for _, report := range reports {
		const q = `
			INSERT INTO docker_container_metrics (
				id,
				instance_id,
				host_id,
				docker_container_row_id,
				docker_container_id,
				recorded_at,
				cpu_percent,
				memory_usage_bytes,
				memory_limit_bytes,
				memory_percent,
				network_rx_bytes,
				network_tx_bytes,
				block_read_bytes,
				block_write_bytes,
				pids_current,
				restart_count
			)
			SELECT $1, $2, $3, dc.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
			FROM docker_containers dc
			WHERE dc.instance_id = $2
			  AND dc.host_id = $3
			  AND dc.docker_container_id = $4
			LIMIT 1
		`
		if _, err := pool.Exec(ctx, q,
			newCUID(),
			instanceID,
			hostID,
			report.DockerContainerID,
			report.RecordedAt,
			report.CPUPercent,
			report.MemoryUsageBytes,
			report.MemoryLimitBytes,
			report.MemoryPercent,
			report.NetworkRXBytes,
			report.NetworkTXBytes,
			report.BlockReadBytes,
			report.BlockWriteBytes,
			report.PidsCurrent,
			report.RestartCount,
		); err != nil {
			return err
		}
	}
	return nil
}

func RecordDockerTelemetryBatch(ctx context.Context, pool *pgxpool.Pool, instanceID, hostID, agentID string, batch *agentv1.DockerTelemetryBatch, receivedAt time.Time) (bool, error) {
	if batch == nil || strings.TrimSpace(batch.BatchId) == "" {
		return true, nil
	}
	const q = `
		INSERT INTO docker_telemetry_batches (
			instance_id,
			host_id,
			agent_id,
			batch_id,
			sequence,
			received_at,
			sample_count,
			inventory_count
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (host_id, batch_id) DO NOTHING
	`
	tag, err := pool.Exec(ctx, q,
		instanceID,
		hostID,
		agentID,
		strings.TrimSpace(batch.BatchId),
		int32(batch.Sequence),
		receivedAt,
		len(batch.Samples),
		len(batch.Inventory),
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func dockerMetricRecordedAt(value int64, receivedAt time.Time) time.Time {
	recordedAt := receivedAt.UTC()
	if value > 0 {
		recordedAt = time.Unix(value, 0).UTC()
	}
	if recordedAt.After(receivedAt.Add(maxDockerMetricFutureSkew)) {
		return receivedAt.UTC()
	}
	if recordedAt.Before(receivedAt.Add(-maxDockerMetricPastAge)) {
		return receivedAt.Add(-maxDockerMetricPastAge).UTC()
	}
	return recordedAt
}

func DockerMetricTimestampInRange(value int64, receivedAt time.Time) bool {
	if value <= 0 {
		return false
	}
	recordedAt := time.Unix(value, 0).UTC()
	return !recordedAt.After(receivedAt.Add(maxDockerMetricFutureSkew)) &&
		!recordedAt.Before(receivedAt.Add(-maxDockerMetricPastAge))
}

func clampPercent(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func uint64ToInt64(value uint64) int64 {
	if value > math.MaxInt64 {
		return math.MaxInt64
	}
	return int64(value)
}

func uint32ToInt32(value uint32) int32 {
	if value > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(value)
}
