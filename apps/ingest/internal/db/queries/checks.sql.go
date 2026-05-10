package queries

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CheckRow represents an active check definition for a host.
type CheckRow struct {
	ID              string
	CheckType       string
	ConfigJSON      string
	IntervalSeconds int
}

type checkQueryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type checkExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// GetChecksForHost returns all enabled, non-deleted checks for a given host and instance.
func GetChecksForHost(ctx context.Context, pool *pgxpool.Pool, hostID, instanceID string) ([]CheckRow, error) {
	return getChecksForHost(ctx, pool, hostID, instanceID)
}

func getChecksForHost(ctx context.Context, queryer checkQueryer, hostID, instanceID string) ([]CheckRow, error) {
	const sql = `
		SELECT id, check_type, config::text, interval_seconds
		FROM checks
		WHERE host_id = $1
		  AND instance_id = $2
		  AND enabled = true
		  AND deleted_at IS NULL
	`
	rows, err := queryer.Query(ctx, sql, hostID, instanceID)
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

var ErrCheckOwnershipMismatch = errors.New("check does not belong to host instance")

// InsertCheckResult persists a single check result row and prunes old rows beyond 100 per check.
func InsertCheckResult(
	ctx context.Context,
	pool *pgxpool.Pool,
	checkID, hostID, instanceID string,
	status, output string,
	durationMs int32,
	ranAt time.Time,
) error {
	if err := insertCheckResult(ctx, pool, checkID, hostID, instanceID, status, output, durationMs, ranAt); err != nil {
		return err
	}
	return pruneCheckResults(ctx, pool, checkID)
}

func insertCheckResult(
	ctx context.Context,
	exec checkExecer,
	checkID, hostID, instanceID string,
	status, output string,
	durationMs int32,
	ranAt time.Time,
) error {
	const q = `
		INSERT INTO check_results (id, check_id, host_id, instance_id, ran_at, status, output, duration_ms)
		SELECT $1, $2, $3, $4, $5, $6, $7, $8
		WHERE EXISTS (
			SELECT 1
			FROM checks
			WHERE id = $2
			  AND host_id = $3
			  AND instance_id = $4
			  AND deleted_at IS NULL
		)
	`
	tag, err := exec.Exec(ctx, q,
		newCUID(), checkID, hostID, instanceID, ranAt, status, output, durationMs,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrCheckOwnershipMismatch
	}
	return nil
}

// pruneCheckResults deletes rows beyond the 100 most recent results for a check.
func pruneCheckResults(ctx context.Context, pool *pgxpool.Pool, checkID string) error {
	const q = `
		DELETE FROM check_results
		WHERE check_id = $1
		  AND id NOT IN (
		    SELECT id FROM check_results
		    WHERE check_id = $1
		    ORDER BY ran_at DESC
		    LIMIT 100
		  )
	`
	_, err := pool.Exec(ctx, q, checkID)
	return err
}
