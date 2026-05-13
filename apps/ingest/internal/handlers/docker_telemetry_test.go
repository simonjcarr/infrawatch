package handlers

import (
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/ingest/internal/db/queries"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestValidateDockerTelemetryBatchRejectsIdentityMismatch(t *testing.T) {
	t.Parallel()

	err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{AgentId: "other-agent"}, "agent-1")
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("status.Code(err) = %v, want %v", status.Code(err), codes.Unauthenticated)
	}
}

func TestValidateDockerTelemetryBatchRejectsOversizedPayload(t *testing.T) {
	t.Parallel()

	err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{PayloadBytes: maxDockerTelemetryPayloadBytes + 1}, "agent-1")
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code(err) = %v, want %v", status.Code(err), codes.InvalidArgument)
	}
}

func TestValidateDockerTelemetryBatchRejectsTooManyInventoryItems(t *testing.T) {
	t.Parallel()

	batch := &agentv1.DockerTelemetryBatch{
		Inventory: make([]*agentv1.DockerContainerInventory, queries.MaxDockerInventoryItemsPerBatch+1),
	}
	err := validateDockerTelemetryBatch(batch, "agent-1")
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code(err) = %v, want %v", status.Code(err), codes.InvalidArgument)
	}
}

func TestValidateDockerTelemetryBatchAcceptsMetricSamples(t *testing.T) {
	t.Parallel()

	err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{
		BatchId:       "batch-1",
		FlushedAtUnix: time.Now().Unix(),
		Samples: []*agentv1.DockerContainerMetricSample{{
			DockerContainerId: "container-1",
			RecordedAtUnix:    time.Now().Add(-time.Second).Unix(),
		}},
	}, "agent-1")
	if err != nil {
		t.Fatalf("validateDockerTelemetryBatch() error = %v, want nil", err)
	}
}

func TestValidateDockerTelemetryBatchRejectsTooManyMetricSamples(t *testing.T) {
	t.Parallel()

	err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{
		Samples: make([]*agentv1.DockerContainerMetricSample, queries.MaxDockerMetricSamplesPerBatch+1),
	}, "agent-1")
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code(err) = %v, want %v", status.Code(err), codes.InvalidArgument)
	}
}

func TestValidateDockerTelemetryBatchRejectsOutOfRangeMetricTimestamps(t *testing.T) {
	t.Parallel()

	err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{
		Samples: []*agentv1.DockerContainerMetricSample{{
			DockerContainerId: "container-1",
			RecordedAtUnix:    time.Now().Add(10 * time.Minute).Unix(),
		}},
	}, "agent-1")
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code(err) = %v, want %v", status.Code(err), codes.InvalidArgument)
	}
}

func TestValidateDockerTelemetryBatchAllowsEmptyAgentID(t *testing.T) {
	t.Parallel()

	if err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{}, "agent-1"); err != nil {
		t.Fatalf("validateDockerTelemetryBatch() error = %v, want nil", err)
	}
}

func TestNormaliseDockerContainerAlertConfigDefaultsAndBounds(t *testing.T) {
	t.Parallel()

	cfg := dockerContainerAlertConfig{
		Rule:              "sustained_cpu",
		DockerContainerID: " container-1 ",
		WindowMinutes:     0,
		Threshold:         200,
		SampleThreshold:   0,
	}

	normaliseDockerContainerAlertConfig(&cfg)

	if cfg.DockerContainerID != "container-1" {
		t.Fatalf("DockerContainerID = %q, want trimmed", cfg.DockerContainerID)
	}
	if cfg.WindowMinutes != 10 {
		t.Fatalf("WindowMinutes = %d, want default 10", cfg.WindowMinutes)
	}
	if cfg.Threshold != 90 {
		t.Fatalf("Threshold = %v, want default 90", cfg.Threshold)
	}
	if cfg.SampleThreshold != 3 {
		t.Fatalf("SampleThreshold = %d, want default 3", cfg.SampleThreshold)
	}
}

func TestNormaliseDockerContainerAlertConfigNetworkDefault(t *testing.T) {
	t.Parallel()

	cfg := dockerContainerAlertConfig{Rule: "high_network_io", Threshold: 0, WindowMinutes: 2000, SampleThreshold: 2000}
	normaliseDockerContainerAlertConfig(&cfg)

	if cfg.Threshold != 1024*1024 {
		t.Fatalf("Threshold = %v, want default bytes/sec", cfg.Threshold)
	}
	if cfg.WindowMinutes != 1440 {
		t.Fatalf("WindowMinutes = %d, want capped 1440", cfg.WindowMinutes)
	}
	if cfg.SampleThreshold != 1000 {
		t.Fatalf("SampleThreshold = %d, want capped 1000", cfg.SampleThreshold)
	}
}
