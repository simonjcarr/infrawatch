package queries

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestDockerStatusReportFromProtoMapsValidStatuses(t *testing.T) {
	t.Parallel()

	observedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	checkedAt := observedAt.Add(-time.Minute)

	tests := []struct {
		name   string
		status agentv1.DockerRuntimeStatus
		want   string
	}{
		{"not installed", agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_NOT_INSTALLED, "not_installed"},
		{"installed", agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_INSTALLED, "installed"},
		{"permission denied", agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_PERMISSION_DENIED, "permission_denied"},
		{"unreachable", agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_UNREACHABLE, "unreachable"},
		{"error", agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_ERROR, "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report, ok := DockerStatusReportFromProto(&agentv1.DockerStatus{
				Status:        tt.status,
				CheckedAtUnix: checkedAt.Unix(),
			}, observedAt)
			if !ok {
				t.Fatal("DockerStatusReportFromProto() ok = false, want true")
			}
			if report.Status != tt.want {
				t.Fatalf("Status = %q, want %q", report.Status, tt.want)
			}
			if !report.CheckedAt.Equal(checkedAt) {
				t.Fatalf("CheckedAt = %s, want %s", report.CheckedAt, checkedAt)
			}
		})
	}
}

func TestDockerStatusReportFromProtoIgnoresMissingAndUnspecified(t *testing.T) {
	t.Parallel()

	observedAt := time.Now()
	if _, ok := DockerStatusReportFromProto(nil, observedAt); ok {
		t.Fatal("nil status ok = true, want false")
	}
	if _, ok := DockerStatusReportFromProto(&agentv1.DockerStatus{}, observedAt); ok {
		t.Fatal("unspecified status ok = true, want false")
	}
}

func TestDockerStatusReportFromProtoClampsFutureCheckedAt(t *testing.T) {
	t.Parallel()

	observedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	report, ok := DockerStatusReportFromProto(&agentv1.DockerStatus{
		Status:        agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_INSTALLED,
		CheckedAtUnix: observedAt.Add(time.Hour).Unix(),
	}, observedAt)
	if !ok {
		t.Fatal("DockerStatusReportFromProto() ok = false, want true")
	}
	if !report.CheckedAt.Equal(observedAt) {
		t.Fatalf("CheckedAt = %s, want observedAt %s", report.CheckedAt, observedAt)
	}
}

func TestDockerStatusReportFromProtoBoundsUntrustedStrings(t *testing.T) {
	t.Parallel()

	report, ok := DockerStatusReportFromProto(&agentv1.DockerStatus{
		Status:         agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_PERMISSION_DENIED,
		RuntimeVersion: " " + strings.Repeat("v", maxDockerStatusVersionBytes+20),
		ApiVersion:     strings.Repeat("a", maxDockerStatusVersionBytes+20),
		ErrorMessage:   strings.Repeat("世", MaxDockerStatusErrorBytes),
	}, time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC))
	if !ok {
		t.Fatal("DockerStatusReportFromProto() ok = false, want true")
	}
	if len(report.RuntimeVersion) > maxDockerStatusVersionBytes {
		t.Fatalf("RuntimeVersion length = %d, want <= %d", len(report.RuntimeVersion), maxDockerStatusVersionBytes)
	}
	if len(report.APIVersion) > maxDockerStatusVersionBytes {
		t.Fatalf("APIVersion length = %d, want <= %d", len(report.APIVersion), maxDockerStatusVersionBytes)
	}
	if len(report.ErrorMessage) > MaxDockerStatusErrorBytes {
		t.Fatalf("ErrorMessage length = %d, want <= %d", len(report.ErrorMessage), MaxDockerStatusErrorBytes)
	}
	if !utf8.ValidString(report.ErrorMessage) {
		t.Fatal("ErrorMessage is not valid UTF-8")
	}
}

func TestDockerStatusReportFromProtoClearsInstalledError(t *testing.T) {
	t.Parallel()

	report, ok := DockerStatusReportFromProto(&agentv1.DockerStatus{
		Status:       agentv1.DockerRuntimeStatus_DOCKER_RUNTIME_STATUS_INSTALLED,
		ErrorMessage: "stale diagnostic",
	}, time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC))
	if !ok {
		t.Fatal("DockerStatusReportFromProto() ok = false, want true")
	}
	if report.ErrorMessage != "" {
		t.Fatalf("ErrorMessage = %q, want empty", report.ErrorMessage)
	}
}
