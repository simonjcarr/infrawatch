package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CheckRow represents an active check definition for a host.
type CheckRow struct {
	ID              string
	CheckType       string
	ConfigJSON      string
	IntervalSeconds int
}

// GetChecksForHost returns all enabled, non-deleted checks for a given host ID.
func GetChecksForHost(ctx context.Context, pool *pgxpool.Pool, hostID string) ([]CheckRow, error) {
	const q = `
		SELECT id, check_type, config::text, interval_seconds
		FROM checks
		WHERE host_id = $1
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []CheckRow
	for rows.Next() {
		var row CheckRow
		if err := rows.Scan(&row.ID, &row.CheckType, &row.ConfigJSON, &row.IntervalSeconds); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// InsertCheckResult persists a single check result row.
func InsertCheckResult(
	ctx context.Context,
	pool *pgxpool.Pool,
	checkID, hostID, orgID string,
	status, output string,
	durationMs int32,
	ranAt time.Time,
) error {
	const q = `
		INSERT INTO check_results (id, check_id, host_id, organisation_id, ran_at, status, output, duration_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := pool.Exec(ctx, q,
		newCUID(), checkID, hostID, orgID, ranAt, status, output, durationMs,
	)
	return err
}
