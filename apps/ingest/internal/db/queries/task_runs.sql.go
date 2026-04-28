package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type taskRunExec interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// PendingAgentTask represents a task_run_hosts row that is ready to be dispatched
// to an agent, along with the parent task_run config.
type PendingAgentTask struct {
	ID         string
	TaskType   string
	ConfigJSON string
	TaskRunID  string
}

// GetPendingTasksForHost returns task_run_hosts rows for the given host that
// are ready to dispatch. A row is eligible when:
//   - status = 'pending'
//   - the parent task_run's max_parallel limit is not yet reached
//
// max_parallel = 0 means unlimited. The parallelism check counts how many
// sibling rows in the same task_run are currently 'running'. This query is
// safe to run concurrently across multiple ingest instances because the
// dispatch path atomically transitions the row to 'running' before sending
// the task to the agent, preventing double-dispatch.
func GetPendingTasksForHost(ctx context.Context, pool *pgxpool.Pool, hostID string) ([]PendingAgentTask, error) {
	const q = `
		SELECT trh.id, tr.task_type, tr.config::text, tr.id AS task_run_id
		FROM task_run_hosts trh
		JOIN task_runs tr ON tr.id = trh.task_run_id
		WHERE trh.host_id    = $1
		  AND trh.status     = 'pending'
		  AND trh.deleted_at IS NULL
		  AND tr.deleted_at  IS NULL
		  AND (
		    tr.max_parallel = 0
		    OR (
		      SELECT COUNT(*)
		      FROM task_run_hosts
		      WHERE task_run_id = tr.id
		        AND status      = 'running'
		        AND deleted_at  IS NULL
		    ) < tr.max_parallel
		  )
		LIMIT 1
	`
	rows, err := pool.Query(ctx, q, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []PendingAgentTask
	for rows.Next() {
		var row PendingAgentTask
		if err := rows.Scan(&row.ID, &row.TaskType, &row.ConfigJSON, &row.TaskRunID); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// GetCancellingTasksForHost returns the task_run_hosts IDs for a given host
// that are in 'cancelling' status. These IDs are sent to the agent so it can
// stop the corresponding in-flight processes.
func GetCancellingTasksForHost(ctx context.Context, pool *pgxpool.Pool, hostID string) ([]string, error) {
	const q = `
		SELECT id
		FROM task_run_hosts
		WHERE host_id    = $1
		  AND status     = 'cancelling'
		  AND deleted_at IS NULL
	`
	rows, err := pool.Query(ctx, q, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// MarkTaskRunHostRunning transitions a task_run_hosts row to 'running' and
// also transitions the parent task_run to 'running' if it is still 'pending'.
// This is done atomically so that a concurrent ingest instance cannot dispatch
// the same task twice.
func MarkTaskRunHostRunning(ctx context.Context, pool *pgxpool.Pool, taskRunHostID string) error {
	const qHost = `
		UPDATE task_run_hosts
		SET status     = 'running',
		    started_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending'
	`
	if _, err := pool.Exec(ctx, qHost, taskRunHostID); err != nil {
		return err
	}

	// Escalate the parent run to 'running' if it was still 'pending'.
	const qRun = `
		UPDATE task_runs tr
		SET status     = 'running',
		    started_at = COALESCE(tr.started_at, NOW()),
		    updated_at = NOW()
		FROM task_run_hosts trh
		WHERE trh.id      = $1
		  AND tr.id       = trh.task_run_id
		  AND tr.status   = 'pending'
	`
	_, err := pool.Exec(ctx, qRun, taskRunHostID)
	return err
}

// AppendTaskOutput appends an incremental output chunk to task_run_hosts.raw_output.
func AppendTaskOutput(ctx context.Context, pool *pgxpool.Pool, taskRunHostID, chunk string) error {
	const q = `
		UPDATE task_run_hosts
		SET raw_output = raw_output || $2,
		    updated_at = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, taskRunHostID, chunk)
	return err
}

// CompleteTaskRunHost stores the final outcome of a task_run_hosts row.
// status should be 'success' or 'failed'.
func CompleteTaskRunHost(
	ctx context.Context,
	pool *pgxpool.Pool,
	taskRunHostID, hostStatus string,
	exitCode int,
	resultJSON, errMsg string,
) error {
	var resultArg interface{}
	if resultJSON != "" {
		resultArg = resultJSON
	}
	// If the row is currently 'cancelling', persist 'cancelled' regardless of
	// the agent-reported outcome — the user requested the stop.
	const q = `
		UPDATE task_run_hosts
		SET status       = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE $2 END,
		    exit_code    = $3,
		    result       = $4::jsonb,
		    completed_at = NOW(),
		    updated_at   = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, taskRunHostID, hostStatus, exitCode, resultArg)
	return err
}

// TimeoutStuckTaskRunHosts marks any task_run_hosts rows that have been in
// 'running' status for longer than maxAge as 'failed', then closes any parent
// task_run whose all hosts are now in a terminal state.
func TimeoutStuckTaskRunHosts(ctx context.Context, pool *pgxpool.Pool, maxAge time.Duration) error {
	return timeoutStuckTaskRunHosts(ctx, pool, maxAge)
}

func timeoutStuckTaskRunHosts(ctx context.Context, exec taskRunExec, maxAge time.Duration) error {
	const q = `
		WITH timed_out AS (
		  UPDATE task_run_hosts
		  SET status       = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
		      exit_code    = -1,
		      completed_at = NOW(),
		      updated_at   = NOW()
		  WHERE status     IN ('running', 'cancelling')
		    AND deleted_at IS NULL
		    AND started_at < NOW() - make_interval(secs => $1::int)
		  RETURNING task_run_id
		),
		affected AS (
		  SELECT DISTINCT task_run_id FROM timed_out
		),
		run_counts AS (
		  SELECT
		    a.task_run_id,
		    COUNT(*) FILTER (WHERE trh.status NOT IN ('success','failed','skipped','cancelled')) AS still_active,
		    COUNT(*) FILTER (WHERE trh.status = 'failed')                                       AS failed_count,
		    COUNT(*) FILTER (WHERE trh.status = 'cancelled')                                    AS cancelled_count
		  FROM affected a
		  JOIN task_run_hosts trh
		    ON trh.task_run_id = a.task_run_id AND trh.deleted_at IS NULL
		  GROUP BY a.task_run_id
		)
		UPDATE task_runs tr
		SET status       = CASE
		                     WHEN rc.failed_count    > 0 THEN 'failed'
		                     WHEN rc.cancelled_count > 0 THEN 'cancelled'
		                     ELSE 'completed'
		                   END,
		    completed_at = NOW(),
		    updated_at   = NOW()
		FROM run_counts rc
		WHERE tr.id             = rc.task_run_id
		  AND rc.still_active   = 0
		  AND tr.status NOT IN ('completed', 'failed', 'cancelled')
	`
	secs := int32(maxAge / time.Second)
	_, err := exec.Exec(ctx, q, secs)
	return err
}

// MaybeCompleteTaskRun looks up the parent task_run for the given
// task_run_hosts.id and closes it if all sibling rows are in a terminal state
// (success / failed / skipped). The run status is 'completed' if all
// non-skipped hosts succeeded, otherwise 'failed'.
func MaybeCompleteTaskRun(ctx context.Context, pool *pgxpool.Pool, taskRunHostID string) error {
	const q = `
		WITH run AS (
		  SELECT task_run_id FROM task_run_hosts WHERE id = $1
		),
		counts AS (
		  SELECT
		    COUNT(*) FILTER (WHERE status NOT IN ('success','failed','skipped','cancelled')) AS active,
		    COUNT(*) FILTER (WHERE status = 'failed')                                       AS failed,
		    COUNT(*) FILTER (WHERE status = 'cancelled')                                    AS cancelled
		  FROM task_run_hosts
		  WHERE task_run_id = (SELECT task_run_id FROM run)
		    AND deleted_at  IS NULL
		)
		UPDATE task_runs
		SET status       = CASE
		                     WHEN (SELECT failed    FROM counts) > 0 THEN 'failed'
		                     WHEN (SELECT cancelled FROM counts) > 0 THEN 'cancelled'
		                     ELSE 'completed'
		                   END,
		    completed_at = NOW(),
		    updated_at   = NOW()
		WHERE id         = (SELECT task_run_id FROM run)
		  AND (SELECT active FROM counts) = 0
		  AND status NOT IN ('completed', 'failed', 'cancelled')
	`
	_, err := pool.Exec(ctx, q, taskRunHostID)
	return err
}
