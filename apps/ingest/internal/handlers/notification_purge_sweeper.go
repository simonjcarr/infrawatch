package handlers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

const notificationPurgeRetention = 90 * 24 * time.Hour

// RunNotificationPurgeSweeper periodically hard-deletes notifications that were
// already soft-deleted outside the retention window.
func RunNotificationPurgeSweeper(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("notification purge sweeper started", "interval", interval, "retention", notificationPurgeRetention)

	runNotificationPurgeTick(ctx, pool, time.Now)

	for {
		select {
		case <-ctx.Done():
			slog.Info("notification purge sweeper stopped")
			return
		case <-ticker.C:
			runNotificationPurgeTick(ctx, pool, time.Now)
		}
	}
}

func runNotificationPurgeTick(ctx context.Context, pool *pgxpool.Pool, now func() time.Time) {
	cutoff := now().Add(-notificationPurgeRetention)
	deleted, err := queries.PurgeSoftDeletedNotifications(ctx, pool, cutoff)
	if err != nil {
		slog.Warn("notification purge sweeper: deleting old soft-deleted notifications", "err", err)
		return
	}
	if deleted > 0 {
		slog.Info("notification purge sweeper: purged notifications", "count", deleted)
	}
}
