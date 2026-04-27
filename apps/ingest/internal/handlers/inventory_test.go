package handlers

import (
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestValidateInventoryChunkAllowsConfiguredLimit(t *testing.T) {
	chunk := &agentv1.SoftwareInventoryChunk{
		ChunkIndex: 7,
		Packages:   make([]*agentv1.SoftwarePackage, maxInventoryPackagesPerChunk),
	}

	if err := validateInventoryChunk(chunk); err != nil {
		t.Fatalf("validateInventoryChunk() unexpected error: %v", err)
	}
}

func TestValidateInventoryChunkRejectsOversizedChunk(t *testing.T) {
	chunk := &agentv1.SoftwareInventoryChunk{
		ChunkIndex: 8,
		Packages:   make([]*agentv1.SoftwarePackage, maxInventoryPackagesPerChunk+1),
	}

	err := validateInventoryChunk(chunk)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status.Code(err) = %v, want %v (err=%v)", status.Code(err), codes.InvalidArgument, err)
	}
	if !strings.Contains(err.Error(), "exceeds maximum") {
		t.Fatalf("unexpected error message: %v", err)
	}
}
