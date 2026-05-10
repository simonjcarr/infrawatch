package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DueSchedule represents a task_schedules row that is ready to fire.
type DueSchedule struct {
	ID             string
	InstanceID     string
	Name           string
	TaskType       string
	ConfigJSON     string
	TargetType     string
	TargetID       string
	MaxParallel    int
	CronExpression string
	Timezone       string
}

// ListSchedulesDue returns up to `limit` enabled schedules whose next_run_at
// has passed. The returned rows are ordered by next_run_at (oldest first) so
// late schedules fire before freshly-due ones.
func ListSchedulesDue(ctx context.Context, pool *pgxpool.Pool, limit int) ([]DueSchedule, error) {
	const q = `
		SELECT id, instance_id, name, task_type, config::text,
		       target_type, target_id, max_parallel, cron_expression, timezone
		FROM task_schedules
		WHERE enabled      = TRUE
		  AND deleted_at   IS NULL
		  AND next_run_at  IS NOT NULL
		  AND next_run_at <= NOW()
		ORDER BY next_run_at ASC
		LIMIT $1
	`
	rows, err := pool.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []DueSchedule
	for rows.Next() {
		var s DueSchedule
		if err := rows.Scan(
			&s.ID, &s.InstanceID, &s.Name, &s.TaskType, &s.ConfigJSON,
			&s.TargetType, &s.TargetID, &s.MaxParallel, &s.CronExpression, &s.Timezone,
		); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ResolveScheduleTargetHosts returns the eligible host IDs for a schedule's
// target. For target_type='host' it returns that single host if it exists and
// is not deleted. For target_type='group' it returns all non-deleted member
// host IDs. For task types that are Linux-only (patch, service) non-Linux
// hosts are filtered out.
func ResolveScheduleTargetHosts(
	ctx context.Context,
	pool *pgxpool.Pool,
	instanceID, targetType, targetID, taskType string,
) (hostIDs []string, err error) {
	linuxOnly := taskType == "patch" || taskType == "service"

	if targetType == "host" {
		const q = `
			SELECT id
			FROM hosts
			WHERE id              = $1
			  AND instance_id = $2
			  AND deleted_at      IS NULL
			  AND ($3 = FALSE OR LOWER(COALESCE(os, '')) = 'linux')
		`
		rows, err := pool.Query(ctx, q, targetID, instanceID, linuxOnly)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			hostIDs = append(hostIDs, id)
		}
		return hostIDs, rows.Err()
	}

	// target_type = 'group'
	const q = `
		SELECT h.id
		FROM host_group_members m
		JOIN hosts h ON h.id = m.host_id
		WHERE m.group_id        = $1
		  AND m.instance_id = $2
		  AND m.deleted_at      IS NULL
		  AND h.deleted_at      IS NULL
		  AND ($3 = FALSE OR LOWER(COALESCE(h.os, '')) = 'linux')
	`
	rows, err := pool.Query(ctx, q, targetID, instanceID, linuxOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		hostIDs = append(hostIDs, id)
	}
	return hostIDs, rows.Err()
}

// InsertScheduledTaskRun creates a task_runs row linked back to the schedule
// and task_run_hosts rows for each host. Returns the new task_run ID.
func InsertScheduledTaskRun(
	ctx context.Context,
	pool *pgxpool.Pool,
	scheduleID, instanceID, targetType, targetID, taskType, configJSON string,
	maxParallel int,
	hostIDs []string,
) (taskRunID string, err error) {
	taskRunID = newCUID()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	const qRun = `
		INSERT INTO task_runs
		  (id, instance_id, triggered_by, scheduled_from_id,
		   target_type, target_id, task_type, config, max_parallel,
		   status, created_at, updated_at)
		VALUES ($1, $2, NULL, $3, $4, $5, $6, $7::jsonb, $8, 'pending', NOW(), NOW())
	`
	if _, err = tx.Exec(ctx, qRun, taskRunID, instanceID, scheduleID, targetType, targetID, taskType, configJSON, maxParallel); err != nil {
		return "", err
	}

	const qHost = `
		INSERT INTO task_run_hosts
		  (id, instance_id, task_run_id, host_id, status, raw_output, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'pending', '', NOW(), NOW())
	`
	for _, hostID := range hostIDs {
		if _, err = tx.Exec(ctx, qHost, newCUID(), instanceID, taskRunID, hostID); err != nil {
			return "", err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return taskRunID, nil
}

// AdvanceScheduleCursor updates last_run_at, next_run_at, and last_run_task_run_id
// for a schedule after a successful fire. taskRunID may be empty when the fire
// was skipped (no eligible hosts).
func AdvanceScheduleCursor(
	ctx context.Context,
	pool *pgxpool.Pool,
	scheduleID string,
	firedAt time.Time,
	nextRunAt time.Time,
	taskRunID string,
) error {
	if taskRunID == "" {
		const q = `
			UPDATE task_schedules
			SET last_run_at = $2,
			    next_run_at = $3,
			    updated_at  = NOW()
			WHERE id = $1
		`
		_, err := pool.Exec(ctx, q, scheduleID, firedAt, nextRunAt)
		return err
	}
	const q = `
		UPDATE task_schedules
		SET last_run_at           = $2,
		    next_run_at           = $3,
		    last_run_task_run_id  = $4,
		    updated_at            = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, scheduleID, firedAt, nextRunAt, taskRunID)
	return err
}

// DisableSchedule disables a schedule — used when its cron expression cannot
// be parsed so the sweeper does not spin on it indefinitely.
func DisableSchedule(ctx context.Context, pool *pgxpool.Pool, scheduleID string, reason string) error {
	const q = `
		UPDATE task_schedules
		SET enabled    = FALSE,
		    metadata   = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('disabled_reason', $2::text, 'disabled_at', NOW()::text),
		    updated_at = NOW()
		WHERE id = $1
	`
	_, err := pool.Exec(ctx, q, scheduleID, reason)
	return err
}
