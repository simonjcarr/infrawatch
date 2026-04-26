package heartbeat

import (
	"context"
	"testing"

	"github.com/carrtech-dev/ct-ops/agent/internal/checks"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestHandleResponseSkipsSelfUpdate(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)

	runner.handleResponse(context.Background(), &agentv1.HeartbeatResponse{
		Ok:              true,
		UpdateAvailable: true,
		LatestVersion:   "v2.0.0",
		DownloadUrl:     "https://example.com/api/agent/download",
	})

	if got := runner.lastSkippedUpdateVersion; got != "v2.0.0" {
		t.Fatalf("lastSkippedUpdateVersion = %q, want %q", got, "v2.0.0")
	}
}

func TestHandleResponseOnlyNotesEachSkippedVersionOnce(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)

	runner.handleResponse(context.Background(), &agentv1.HeartbeatResponse{
		Ok:              true,
		UpdateAvailable: true,
		LatestVersion:   "v2.0.0",
		DownloadUrl:     "https://example.com/api/agent/download",
	})
	runner.handleResponse(context.Background(), &agentv1.HeartbeatResponse{
		Ok:              true,
		UpdateAvailable: true,
		LatestVersion:   "v2.0.0",
		DownloadUrl:     "https://example.com/api/agent/download",
	})

	if got := runner.lastSkippedUpdateVersion; got != "v2.0.0" {
		t.Fatalf("lastSkippedUpdateVersion = %q, want %q", got, "v2.0.0")
	}

	runner.handleResponse(context.Background(), &agentv1.HeartbeatResponse{
		Ok:              true,
		UpdateAvailable: true,
		LatestVersion:   "v2.1.0",
		DownloadUrl:     "https://example.com/api/agent/download",
	})

	if got := runner.lastSkippedUpdateVersion; got != "v2.1.0" {
		t.Fatalf("lastSkippedUpdateVersion = %q, want %q", got, "v2.1.0")
	}
}
