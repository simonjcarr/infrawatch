package queries

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type fakeEnrolmentQueryer struct {
	sql  string
	args []any
	err  error
}

func (f *fakeEnrolmentQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.sql = sql
	f.args = args
	return fakeEnrolmentRow{err: f.err}
}

type fakeEnrolmentRow struct {
	err error
}

func (r fakeEnrolmentRow) Scan(_ ...any) error {
	return r.err
}

func TestConsumeEnrolmentTokenAtomicallyChecksUsageLimit(t *testing.T) {
	t.Parallel()

	sentinel := errors.New("stop after query capture")
	queryer := &fakeEnrolmentQueryer{err: sentinel}

	_, err := consumeEnrolmentToken(context.Background(), queryer, "token-secret")
	if !errors.Is(err, sentinel) {
		t.Fatalf("consumeEnrolmentToken error = %v, want sentinel scan error", err)
	}

	if !strings.Contains(queryer.sql, "UPDATE agent_enrolment_tokens") {
		t.Fatalf("query does not update token usage: %s", queryer.sql)
	}
	if !strings.Contains(queryer.sql, "usage_count = usage_count + 1") {
		t.Fatalf("query does not increment usage_count: %s", queryer.sql)
	}
	if !strings.Contains(queryer.sql, "max_uses IS NULL OR usage_count < max_uses") {
		t.Fatalf("query does not enforce max_uses while consuming: %s", queryer.sql)
	}
	if !strings.Contains(queryer.sql, "FOR UPDATE") {
		t.Fatalf("query does not lock the candidate token row: %s", queryer.sql)
	}
	if !strings.Contains(queryer.sql, "RETURNING id, instance_id") {
		t.Fatalf("query does not return the consumed token row: %s", queryer.sql)
	}
	if len(queryer.args) != 1 || queryer.args[0] != "token-secret" {
		t.Fatalf("args = %#v, want token secret", queryer.args)
	}
}
