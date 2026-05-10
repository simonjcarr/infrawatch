package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertHostMetricByAgentID inserts a single time-series metric row for the host
// associated with the given agent. Uses a subquery so no separate host lookup is needed.
func InsertHostMetricByAgentID(
	ctx context.Context,
	pool *pgxpool.Pool,
	instanceID, agentID string,
	recordedAt time.Time,
	cpu, memory, disk float32,
	uptime int64,
) error {
	const q = `
		INSERT INTO host_metrics (id, instance_id, host_id, recorded_at, cpu_percent, memory_percent, disk_percent, uptime_seconds)
		SELECT $1, $2, h.id, $3, $4, $5, $6, $7
		FROM hosts h
		WHERE h.agent_id = $8 AND h.deleted_at IS NULL
		LIMIT 1
	`
	_, err := pool.Exec(ctx, q,
		newCUID(), instanceID, recordedAt,
		cpu, memory, disk, uptime,
		agentID,
	)
	return err
}
