package queries

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type notificationPurgeExec interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// PurgeSoftDeletedNotifications permanently removes notifications that were
// already soft-deleted before cutoff.
func PurgeSoftDeletedNotifications(ctx context.Context, pool *pgxpool.Pool, cutoff time.Time) (int64, error) {
	return purgeSoftDeletedNotifications(ctx, pool, cutoff)
}

func purgeSoftDeletedNotifications(ctx context.Context, exec notificationPurgeExec, cutoff time.Time) (int64, error) {
	const q = `
		DELETE FROM notifications
		WHERE deleted_at IS NOT NULL
		  AND deleted_at < $1
	`
	tag, err := exec.Exec(ctx, q, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
