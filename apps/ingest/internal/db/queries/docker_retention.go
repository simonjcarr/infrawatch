package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const DockerTelemetryBatchRetention = 7 * 24 * time.Hour

type dockerRetentionExec interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type DockerTelemetryRetentionResult struct {
	MetricRows int64
	BatchRows  int64
}

// PurgeExpiredDockerTelemetry deletes Docker metric rows by each host's
// effective retention and removes old idempotency records after a short window.
func PurgeExpiredDockerTelemetry(ctx context.Context, pool *pgxpool.Pool, now time.Time) (DockerTelemetryRetentionResult, error) {
	return purgeExpiredDockerTelemetry(ctx, pool, now)
}

func purgeExpiredDockerTelemetry(ctx context.Context, exec dockerRetentionExec, now time.Time) (DockerTelemetryRetentionResult, error) {
	const metricsQuery = `
		WITH host_retention AS (
			SELECT
				h.instance_id,
				h.id AS host_id,
				LEAST(
					365,
					GREATEST(
						1,
						COALESCE(
							CASE
								WHEN h.metadata #>> '{dockerSettings,retentionDaysOverride}' ~ '^[0-9]+$'
								THEN (h.metadata #>> '{dockerSettings,retentionDaysOverride}')::integer
								ELSE NULL
							END,
							i.docker_metric_retention_days,
							30
						)
					)
				) AS retention_days
			FROM hosts h
			JOIN instance_settings i ON i.id = h.instance_id
			WHERE h.deleted_at IS NULL
		)
		DELETE FROM docker_container_metrics m
		USING host_retention hr
		WHERE m.instance_id = hr.instance_id
		  AND m.host_id = hr.host_id
		  AND m.recorded_at < $1::timestamptz - make_interval(days => hr.retention_days)
	`
	metricsTag, err := exec.Exec(ctx, metricsQuery, now)
	if err != nil {
		return DockerTelemetryRetentionResult{}, err
	}

	const batchesQuery = `
		DELETE FROM docker_telemetry_batches
		WHERE received_at < $1::timestamptz - INTERVAL '7 days'
	`
	batchesTag, err := exec.Exec(ctx, batchesQuery, now)
	if err != nil {
		return DockerTelemetryRetentionResult{}, err
	}

	return DockerTelemetryRetentionResult{
		MetricRows: metricsTag.RowsAffected(),
		BatchRows:  batchesTag.RowsAffected(),
	}, nil
}
