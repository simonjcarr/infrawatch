package queries

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type fakeTaskRunExec struct {
	sql  string
	args []any
	tag  pgconn.CommandTag
	err  error
}

func (f *fakeTaskRunExec) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.sql = sql
	f.args = args
	return f.tag, f.err
}

func TestTimeoutStuckTaskRunHostsUsesTypedInterval(t *testing.T) {
	t.Parallel()

	exec := &fakeTaskRunExec{tag: pgconn.NewCommandTag("UPDATE 2")}

	if err := timeoutStuckTaskRunHosts(context.Background(), exec, 90*time.Minute); err != nil {
		t.Fatalf("timeoutStuckTaskRunHosts: %v", err)
	}

	if !strings.Contains(exec.sql, "make_interval(secs => $1::int)") {
		t.Fatalf("query does not build a typed interval: %s", exec.sql)
	}
	if strings.Contains(exec.sql, "|| ' seconds'") {
		t.Fatalf("query still concatenates seconds into text: %s", exec.sql)
	}
	if len(exec.args) != 1 {
		t.Fatalf("args = %#v, want exactly one argument", exec.args)
	}
	secs, ok := exec.args[0].(int32)
	if !ok {
		t.Fatalf("arg type = %T, want int32", exec.args[0])
	}
	if secs != 5400 {
		t.Fatalf("secs = %d, want 5400", secs)
	}
}
