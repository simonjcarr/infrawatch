package queries

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeCheckQueryer struct {
	sql  string
	args []any
	err  error
}

func (f *fakeCheckQueryer) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.sql = sql
	f.args = args
	return nil, f.err
}

type fakeCheckExecer struct {
	sql  string
	args []any
	tag  pgconn.CommandTag
	err  error
}

func (f *fakeCheckExecer) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.sql = sql
	f.args = args
	return f.tag, f.err
}

func TestGetChecksForHostScopesByHostAndInstance(t *testing.T) {
	t.Parallel()

	queryErr := errors.New("stop after query capture")
	queryer := &fakeCheckQueryer{err: queryErr}

	_, err := getChecksForHost(context.Background(), queryer, "host-victim", "org-victim")
	if !errors.Is(err, queryErr) {
		t.Fatalf("getChecksForHost error = %v, want sentinel query error", err)
	}
	if !strings.Contains(queryer.sql, "WHERE host_id = $1") {
		t.Fatalf("query does not filter by host_id: %s", queryer.sql)
	}
	if !strings.Contains(queryer.sql, "AND instance_id = $2") {
		t.Fatalf("query does not filter by instance_id: %s", queryer.sql)
	}
	if len(queryer.args) != 2 || queryer.args[0] != "host-victim" || queryer.args[1] != "org-victim" {
		t.Fatalf("args = %#v, want host and instance", queryer.args)
	}
}

func TestInsertCheckResultRejectsCrossInstanceCheckID(t *testing.T) {
	t.Parallel()

	execer := &fakeCheckExecer{tag: pgconn.NewCommandTag("INSERT 0 0")}

	err := insertCheckResult(
		context.Background(),
		execer,
		"check-attacker",
		"host-victim",
		"org-victim",
		"pass",
		"ok",
		123,
		time.Unix(100, 0),
	)
	if !errors.Is(err, ErrCheckOwnershipMismatch) {
		t.Fatalf("insertCheckResult error = %v, want ErrCheckOwnershipMismatch", err)
	}
	if !strings.Contains(execer.sql, "WHERE id = $2") ||
		!strings.Contains(execer.sql, "AND host_id = $3") ||
		!strings.Contains(execer.sql, "AND instance_id = $4") {
		t.Fatalf("insert query does not enforce check ownership: %s", execer.sql)
	}
}
