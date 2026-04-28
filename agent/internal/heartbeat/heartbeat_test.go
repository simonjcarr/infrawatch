package heartbeat

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/carrtech-dev/ct-ops/agent/internal/checks"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestHandleResponseStartsSelfUpdate(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)
	started := make(chan struct{}, 1)
	runner.updateFunc = func(latestVersion, downloadURL string, pinnedServerCertPEM []byte) error {
		if latestVersion != "v2.0.0" {
			t.Errorf("latestVersion = %q, want %q", latestVersion, "v2.0.0")
		}
		if downloadURL != "https://example.com/api/agent/download" {
			t.Errorf("downloadURL = %q, want %q", downloadURL, "https://example.com/api/agent/download")
		}
		started <- struct{}{}
		return nil
	}

	runner.handleResponse(context.Background(), &agentv1.HeartbeatResponse{
		Ok:              true,
		UpdateAvailable: true,
		LatestVersion:   "v2.0.0",
		DownloadUrl:     "https://example.com/api/agent/download",
	})

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("self-update was not started")
	}
}

func TestHandleResponseDeduplicatesSelfUpdateInFlight(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	runner.updateFunc = func(latestVersion, downloadURL string, pinnedServerCertPEM []byte) error {
		started <- struct{}{}
		<-release
		return nil
	}

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

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("self-update was not started")
	}

	select {
	case <-started:
		t.Fatal("duplicate self-update was started while the first update was in flight")
	default:
	}
	close(release)
}

func TestBufferTaskProgressTruncatesPerTask(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)

	runner.bufferTaskProgress("task-1", strings.Repeat("x", maxBufferedTaskProgressBytesPerTask+128))
	progress := runner.drainTaskProgress()
	if len(progress) != 1 {
		t.Fatalf("len(progress) = %d, want 1", len(progress))
	}

	got := progress[0].OutputChunk
	if len(got) != maxBufferedTaskProgressBytesPerTask {
		t.Fatalf("len(output_chunk) = %d, want %d", len(got), maxBufferedTaskProgressBytesPerTask)
	}
	if !strings.HasSuffix(got, taskProgressTruncatedMarker) {
		t.Fatalf("output chunk missing truncation marker: %q", got[len(got)-minInt(len(got), 80):])
	}
}

func TestBufferTaskProgressTruncatesPerInterval(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)

	for i := range 4 {
		runner.bufferTaskProgress(
			"task-"+string(rune('1'+i)),
			strings.Repeat("a", 60*1024),
		)
	}
	runner.bufferTaskProgress("task-5", strings.Repeat("b", 32*1024))

	progress := runner.drainTaskProgress()
	if len(progress) != 5 {
		t.Fatalf("len(progress) = %d, want 5", len(progress))
	}

	last := progress[4].OutputChunk
	if !strings.HasSuffix(last, taskProgressTruncatedMarker) {
		t.Fatalf("last output chunk missing truncation marker")
	}
	total := 0
	for _, p := range progress {
		total += len(p.OutputChunk)
	}
	if total != maxBufferedTaskProgressBytesPerInterval {
		t.Fatalf("total buffered bytes = %d, want %d", total, maxBufferedTaskProgressBytesPerInterval)
	}
}

func TestBufferTaskResultClampsOversizedPayload(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)

	runner.bufferTaskResult(&agentv1.AgentTaskResult{
		TaskId:     "task-1",
		TaskType:   "custom_script",
		ExitCode:   1,
		ResultJson: strings.Repeat("r", maxBufferedTaskResultBytesPerTask),
		Error:      strings.Repeat("e", maxBufferedTaskResultBytesPerTask),
	})

	results := runner.drainTaskResults()
	if len(results) != 1 {
		t.Fatalf("len(results) = %d, want 1", len(results))
	}
	if size := taskResultSize(results[0]); size > maxBufferedTaskResultBytesPerTask {
		t.Fatalf("task result size = %d, want <= %d", size, maxBufferedTaskResultBytesPerTask)
	}
	if !strings.Contains(results[0].Error, "truncated") {
		t.Fatalf("expected truncation note in error, got %q", results[0].Error)
	}
}

func TestDrainTaskResultsPreservesOverflowForNextHeartbeat(t *testing.T) {
	runner := New(nil, "agent-id", "jwt", "v1.0.0", 30, checks.NewExecutor(), "", nil)

	payload := strings.Repeat("r", 12*1024)
	for i := range 6 {
		runner.bufferTaskResult(&agentv1.AgentTaskResult{
			TaskId:     "task-" + string(rune('1'+i)),
			TaskType:   "custom_script",
			ResultJson: payload,
		})
	}

	first := runner.drainTaskResults()
	if len(first) != 5 {
		t.Fatalf("len(first) = %d, want 5", len(first))
	}
	second := runner.drainTaskResults()
	if len(second) != 1 {
		t.Fatalf("len(second) = %d, want 1", len(second))
	}
}
