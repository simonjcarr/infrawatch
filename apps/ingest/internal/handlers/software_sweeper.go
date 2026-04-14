package handlers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infrawatch/ingest/internal/db/queries"
)

const softwareSweeperInterval = 60 * time.Second

// RunSoftwareSweeper ticks every minute and enqueues software_inventory tasks
// for hosts that are overdue for a scan. A host is overdue when:
//   - Its organisation has softwareInventorySettings.enabled = true, AND
//   - lastSoftwareScanAt IS NULL or older than the configured intervalHours
//
// The sweeper does nothing when no organisation has scanning enabled, so it
// adds no overhead for installations that don't use the feature.
func RunSoftwareSweeper(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(softwareSweeperInterval)
	defer ticker.Stop()

	slog.Info("software sweeper started", "interval", softwareSweeperInterval)

	for {
		select {
		case <-ctx.Done():
			slog.Info("software sweeper stopped")
			return
		case <-ticker.C:
			runSweeperTick(ctx, pool)
		}
	}
}

func runSweeperTick(ctx context.Context, pool *pgxpool.Pool) {
	hosts, err := queries.GetHostsDueForSoftwareScan(ctx, pool)
	if err != nil {
		slog.Warn("software sweeper: querying due hosts", "err", err)
		return
	}
	if len(hosts) == 0 {
		return
	}

	slog.Info("software sweeper: enqueuing scans", "count", len(hosts))
	for _, h := range hosts {
		_, err := queries.InsertSoftwareInventoryTask(ctx, pool, h.OrgID, h.ID)
		if err != nil {
			slog.Warn("software sweeper: inserting task", "host_id", h.ID, "err", err)
			continue
		}
		slog.Info("software sweeper: enqueued scan", "host_id", h.ID, "org_id", h.OrgID)
	}
}
