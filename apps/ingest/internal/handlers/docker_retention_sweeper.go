package handlers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

// RunDockerTelemetryRetentionSweeper periodically removes Docker telemetry that
// is older than each host's effective retention setting.
func RunDockerTelemetryRetentionSweeper(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("docker telemetry retention sweeper started", "interval", interval, "batch_retention", queries.DockerTelemetryBatchRetention)

	runDockerTelemetryRetentionTick(ctx, pool, time.Now)

	for {
		select {
		case <-ctx.Done():
			slog.Info("docker telemetry retention sweeper stopped")
			return
		case <-ticker.C:
			runDockerTelemetryRetentionTick(ctx, pool, time.Now)
		}
	}
}

func runDockerTelemetryRetentionTick(ctx context.Context, pool *pgxpool.Pool, now func() time.Time) {
	deleted, err := queries.PurgeExpiredDockerTelemetry(ctx, pool, now().UTC())
	if err != nil {
		slog.Warn("docker telemetry retention sweeper: deleting expired telemetry", "err", err)
		return
	}
	if deleted.MetricRows > 0 || deleted.BatchRows > 0 {
		slog.Info("docker telemetry retention sweeper: purged telemetry", "metric_rows", deleted.MetricRows, "batch_rows", deleted.BatchRows)
	}
}
