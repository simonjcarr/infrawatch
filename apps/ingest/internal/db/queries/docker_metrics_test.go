package queries

import (
	"strings"
	"testing"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestDockerMetricReportsFromProtoNormalizesSamples(t *testing.T) {
	t.Parallel()

	receivedAt := time.Date(2026, 5, 13, 9, 30, 0, 0, time.UTC)
	reports := DockerMetricReportsFromProto([]*agentv1.DockerContainerMetricSample{
		nil,
		{
			DockerContainerId: " abc123 ",
			RecordedAtUnix:    receivedAt.Add(-time.Minute).Unix(),
			CpuPercent:        17.5,
			MemoryUsageBytes:  1024,
			MemoryLimitBytes:  2048,
			MemoryPercent:     50,
			NetworkRxBytes:    100,
			NetworkTxBytes:    200,
			BlockReadBytes:    300,
			BlockWriteBytes:   400,
			PidsCurrent:       7,
			RestartCount:      2,
		},
		{DockerContainerId: " "},
	}, receivedAt)

	if len(reports) != 1 {
		t.Fatalf("len(reports) = %d, want 1", len(reports))
	}
	got := reports[0]
	if got.DockerContainerID != "abc123" {
		t.Fatalf("DockerContainerID = %q, want normalized id", got.DockerContainerID)
	}
	if !got.RecordedAt.Equal(receivedAt.Add(-time.Minute)) {
		t.Fatalf("RecordedAt = %s, want source time", got.RecordedAt)
	}
	if got.CPUPercent != 17.5 || got.MemoryPercent != 50 {
		t.Fatalf("percent fields = cpu %v memory %v", got.CPUPercent, got.MemoryPercent)
	}
	if got.NetworkRXBytes != 100 || got.BlockWriteBytes != 400 || got.PidsCurrent != 7 || got.RestartCount != 2 {
		t.Fatalf("metric fields were not preserved: %#v", got)
	}
}

func TestDockerMetricReportsFromProtoBoundsValues(t *testing.T) {
	t.Parallel()

	receivedAt := time.Date(2026, 5, 13, 9, 30, 0, 0, time.UTC)
	reports := DockerMetricReportsFromProto([]*agentv1.DockerContainerMetricSample{{
		DockerContainerId: strings.Repeat("世", maxDockerContainerIDBytes),
		RecordedAtUnix:    receivedAt.Add(10 * time.Minute).Unix(),
		CpuPercent:        -1,
		MemoryPercent:     500,
	}}, receivedAt)

	if len(reports) != 1 {
		t.Fatalf("len(reports) = %d, want 1", len(reports))
	}
	if len(reports[0].DockerContainerID) > maxDockerContainerIDBytes {
		t.Fatalf("DockerContainerID length = %d, want <= %d", len(reports[0].DockerContainerID), maxDockerContainerIDBytes)
	}
	if !reports[0].RecordedAt.Equal(receivedAt) {
		t.Fatalf("RecordedAt = %s, want clamped receivedAt %s", reports[0].RecordedAt, receivedAt)
	}
	if reports[0].CPUPercent != 0 || reports[0].MemoryPercent != 100 {
		t.Fatalf("percent fields = cpu %v memory %v, want clamped 0/100", reports[0].CPUPercent, reports[0].MemoryPercent)
	}
}
