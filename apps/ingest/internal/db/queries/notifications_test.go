package queries

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type fakeNotificationPurgeExec struct {
	sql  string
	args []any
	tag  pgconn.CommandTag
	err  error
}

func (f *fakeNotificationPurgeExec) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.sql = sql
	f.args = args
	return f.tag, f.err
}

func TestPurgeSoftDeletedNotifications(t *testing.T) {
	t.Parallel()

	cutoff := time.Date(2026, 1, 27, 12, 0, 0, 0, time.UTC)
	exec := &fakeNotificationPurgeExec{tag: pgconn.NewCommandTag("DELETE 7")}

	deleted, err := purgeSoftDeletedNotifications(context.Background(), exec, cutoff)
	if err != nil {
		t.Fatalf("purgeSoftDeletedNotifications: %v", err)
	}

	if deleted != 7 {
		t.Fatalf("deleted = %d, want 7", deleted)
	}
	if !strings.Contains(exec.sql, "DELETE FROM notifications") {
		t.Fatalf("query did not delete notifications: %s", exec.sql)
	}
	if !strings.Contains(exec.sql, "deleted_at IS NOT NULL") {
		t.Fatalf("query does not require soft-deleted rows: %s", exec.sql)
	}
	if !strings.Contains(exec.sql, "deleted_at < $1") {
		t.Fatalf("query does not apply cutoff parameter: %s", exec.sql)
	}
	if len(exec.args) != 1 || exec.args[0] != cutoff {
		t.Fatalf("args = %#v, want cutoff only", exec.args)
	}
}
