package queries

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type fakeDockerRetentionExec struct {
	sqls []string
	args [][]any
	tags []pgconn.CommandTag
	err  error
}

func (f *fakeDockerRetentionExec) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.sqls = append(f.sqls, sql)
	f.args = append(f.args, args)
	if f.err != nil {
		return pgconn.CommandTag{}, f.err
	}
	if len(f.tags) == 0 {
		return pgconn.CommandTag{}, nil
	}
	tag := f.tags[0]
	f.tags = f.tags[1:]
	return tag, nil
}

func TestPurgeExpiredDockerTelemetry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)
	exec := &fakeDockerRetentionExec{
		tags: []pgconn.CommandTag{
			pgconn.NewCommandTag("DELETE 11"),
			pgconn.NewCommandTag("DELETE 3"),
		},
	}

	deleted, err := purgeExpiredDockerTelemetry(context.Background(), exec, now)
	if err != nil {
		t.Fatalf("purgeExpiredDockerTelemetry: %v", err)
	}

	if deleted.MetricRows != 11 {
		t.Fatalf("MetricRows = %d, want 11", deleted.MetricRows)
	}
	if deleted.BatchRows != 3 {
		t.Fatalf("BatchRows = %d, want 3", deleted.BatchRows)
	}
	if len(exec.sqls) != 2 {
		t.Fatalf("executed %d statements, want 2", len(exec.sqls))
	}

	metricsSQL := exec.sqls[0]
	if !strings.Contains(metricsSQL, "DELETE FROM docker_container_metrics") {
		t.Fatalf("metric query did not delete docker metrics: %s", metricsSQL)
	}
	if !strings.Contains(metricsSQL, "docker_metric_retention_days") {
		t.Fatalf("metric query does not use global Docker retention: %s", metricsSQL)
	}
	if !strings.Contains(metricsSQL, "metadata #>> '{dockerSettings,retentionDaysOverride}'") {
		t.Fatalf("metric query does not use host Docker override: %s", metricsSQL)
	}
	if !strings.Contains(metricsSQL, "make_interval(days => hr.retention_days)") {
		t.Fatalf("metric query does not apply host-effective retention interval: %s", metricsSQL)
	}

	batchSQL := exec.sqls[1]
	if !strings.Contains(batchSQL, "DELETE FROM docker_telemetry_batches") {
		t.Fatalf("batch query did not delete telemetry batches: %s", batchSQL)
	}
	if !strings.Contains(batchSQL, "$1::timestamptz - INTERVAL '7 days'") {
		t.Fatalf("batch query does not use 7 day retention: %s", batchSQL)
	}

	if len(exec.args[0]) != 1 || exec.args[0][0] != now {
		t.Fatalf("metric args = %#v, want now only", exec.args[0])
	}
	if len(exec.args[1]) != 1 || exec.args[1][0] != now {
		t.Fatalf("batch args = %#v, want now only", exec.args[1])
	}
}
