package handlers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
)

const scheduleSweepBatchSize = 100

// RunTaskScheduleSweeper ticks every `interval` and fires any task_schedules
// whose next_run_at has passed. For each due schedule it:
//  1. resolves the target host list (respecting Linux-only task types),
//  2. inserts a task_run + task_run_hosts rows linked back via scheduled_from_id,
//  3. advances next_run_at using the cron expression + timezone on the row.
//
// If the schedule has no eligible hosts (group empty or target deleted), we
// advance next_run_at without inserting a run and log a warning. If the cron
// expression fails to parse, the schedule is disabled so the sweeper does not
// spin.
func RunTaskScheduleSweeper(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("task schedule sweeper started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			slog.Info("task schedule sweeper stopped")
			return
		case <-ticker.C:
			runScheduleSweepTick(ctx, pool)
		}
	}
}

func runScheduleSweepTick(ctx context.Context, pool *pgxpool.Pool) {
	due, err := queries.ListSchedulesDue(ctx, pool, scheduleSweepBatchSize)
	if err != nil {
		slog.Warn("schedule sweeper: listing due schedules", "err", err)
		return
	}
	if len(due) == 0 {
		return
	}

	slog.Info("schedule sweeper: firing schedules", "count", len(due))
	for _, s := range due {
		fireSchedule(ctx, pool, s)
	}
}

// fireSchedule handles a single due schedule. It is resilient to per-schedule
// failures — a bad host lookup or insert on one schedule does not block others.
func fireSchedule(ctx context.Context, pool *pgxpool.Pool, s queries.DueSchedule) {
	now := time.Now().UTC()

	nextRunAt, cronErr := computeNextRun(s.CronExpression, s.Timezone, now)
	if cronErr != nil {
		slog.Warn("schedule sweeper: invalid cron — disabling", "schedule_id", s.ID, "cron", s.CronExpression, "err", cronErr)
		if err := queries.DisableSchedule(ctx, pool, s.ID, "invalid cron: "+cronErr.Error()); err != nil {
			slog.Warn("schedule sweeper: disable failed", "schedule_id", s.ID, "err", err)
		}
		return
	}

	hostIDs, err := queries.ResolveScheduleTargetHosts(ctx, pool, s.OrgID, s.TargetType, s.TargetID, s.TaskType)
	if err != nil {
		slog.Warn("schedule sweeper: resolving target hosts", "schedule_id", s.ID, "err", err)
		return
	}

	if len(hostIDs) == 0 {
		slog.Info("schedule sweeper: no eligible hosts — advancing cursor",
			"schedule_id", s.ID, "target_type", s.TargetType, "target_id", s.TargetID, "task_type", s.TaskType)
		if err := queries.AdvanceScheduleCursor(ctx, pool, s.ID, now, nextRunAt, ""); err != nil {
			slog.Warn("schedule sweeper: advancing cursor", "schedule_id", s.ID, "err", err)
		}
		return
	}

	taskRunID, err := queries.InsertScheduledTaskRun(
		ctx, pool, s.ID, s.OrgID, s.TargetType, s.TargetID, s.TaskType, s.ConfigJSON, s.MaxParallel, hostIDs,
	)
	if err != nil {
		slog.Warn("schedule sweeper: inserting task run", "schedule_id", s.ID, "err", err)
		return
	}

	slog.Info("schedule sweeper: triggered task run",
		"schedule_id", s.ID, "schedule_name", s.Name, "task_run_id", taskRunID,
		"task_type", s.TaskType, "hosts", len(hostIDs), "next_run_at", nextRunAt)

	if err := queries.AdvanceScheduleCursor(ctx, pool, s.ID, now, nextRunAt, taskRunID); err != nil {
		slog.Warn("schedule sweeper: advancing cursor", "schedule_id", s.ID, "err", err)
	}
}

var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

// computeNextRun returns the next fire time strictly after `from` for the
// given 5-field cron expression and IANA timezone.
func computeNextRun(expr, tz string, from time.Time) (time.Time, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, err
	}
	sched, err := cronParser.Parse(expr)
	if err != nil {
		return time.Time{}, err
	}
	return sched.Next(from.In(loc)).UTC(), nil
}
