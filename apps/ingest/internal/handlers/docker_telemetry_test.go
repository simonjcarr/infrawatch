package handlers

import (
	"testing"

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

func TestValidateDockerTelemetryBatchRejectsMetricSamplesUntilImplemented(t *testing.T) {
	t.Parallel()

	err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{
		Samples: []*agentv1.DockerContainerMetricSample{{DockerContainerId: "container-1"}},
	}, "agent-1")
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("status.Code(err) = %v, want %v", status.Code(err), codes.Unimplemented)
	}
}

func TestValidateDockerTelemetryBatchAllowsEmptyAgentID(t *testing.T) {
	t.Parallel()

	if err := validateDockerTelemetryBatch(&agentv1.DockerTelemetryBatch{}, "agent-1"); err != nil {
		t.Fatalf("validateDockerTelemetryBatch() error = %v, want nil", err)
	}
}
