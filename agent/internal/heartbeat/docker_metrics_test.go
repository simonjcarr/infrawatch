package heartbeat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestCollectDockerMetricSamplesCalculatesStats(t *testing.T) {
	handler := http.NewServeMux()
	handler.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("all") {
			t.Fatalf("all query = %q, want omitted so Docker returns running containers", r.URL.Query().Get("all"))
		}
		_ = json.NewEncoder(w).Encode([]dockerContainerListItem{
			{ID: "abcdef123456", State: "running"},
		})
	})
	handler.HandleFunc("/containers/abcdef123456/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("stream") != "false" {
			t.Fatalf("stream query = %q, want false", r.URL.Query().Get("stream"))
		}
		_ = json.NewEncoder(w).Encode(dockerContainerStats{
			CPUStats: dockerCPUStats{
				CPUUsage: dockerCPUUsage{
					TotalUsage:  5_000_000_000,
					PercpuUsage: []uint64{1, 2},
				},
				SystemCPUUsage: 30_000_000_000,
				OnlineCPUs:     2,
			},
			PreCPUStats: dockerCPUStats{
				CPUUsage:       dockerCPUUsage{TotalUsage: 3_000_000_000},
				SystemCPUUsage: 10_000_000_000,
			},
			MemoryStats: dockerMemoryStats{
				Usage: 700,
				Limit: 1000,
				Stats: map[string]uint64{"cache": 100},
			},
			Networks: map[string]dockerNetworkStats{
				"eth0": {RxBytes: 10, TxBytes: 20},
				"eth1": {RxBytes: 30, TxBytes: 40},
			},
			BlkioStats: dockerBlkioStats{
				IoServiceBytesRecursive: []dockerBlkioServiceBytes{
					{Op: "Read", Value: 100},
					{Op: "Write", Value: 200},
					{Op: "Discard", Value: 300},
				},
			},
			PidsStats: dockerPidsStats{Current: 7},
		})
	})
	handler.HandleFunc("/containers/abcdef123456/json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(dockerContainerInspect{RestartCount: 4})
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	samples, err := collectDockerMetricSamplesWithClient(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("collectDockerMetricSamplesWithClient() error = %v", err)
	}
	if len(samples) != 1 {
		t.Fatalf("samples length = %d, want 1", len(samples))
	}

	got := samples[0]
	if got.DockerContainerId != "abcdef123456" {
		t.Fatalf("docker_container_id = %q", got.DockerContainerId)
	}
	if got.RecordedAtUnix == 0 {
		t.Fatal("recorded_at_unix was not set")
	}
	if got.CpuPercent != 20 {
		t.Fatalf("cpu_percent = %v, want 20", got.CpuPercent)
	}
	if got.MemoryUsageBytes != 600 || got.MemoryLimitBytes != 1000 || got.MemoryPercent != 60 {
		t.Fatalf("memory fields = usage %d limit %d percent %v", got.MemoryUsageBytes, got.MemoryLimitBytes, got.MemoryPercent)
	}
	if got.NetworkRxBytes != 40 || got.NetworkTxBytes != 60 {
		t.Fatalf("network fields = rx %d tx %d", got.NetworkRxBytes, got.NetworkTxBytes)
	}
	if got.BlockReadBytes != 100 || got.BlockWriteBytes != 200 {
		t.Fatalf("block fields = read %d write %d", got.BlockReadBytes, got.BlockWriteBytes)
	}
	if got.PidsCurrent != 7 || got.RestartCount != 4 {
		t.Fatalf("pids/restarts = %d/%d", got.PidsCurrent, got.RestartCount)
	}
}

func TestCollectDockerMetricSamplesSkipsNonRunningContainers(t *testing.T) {
	handler := http.NewServeMux()
	handler.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]dockerContainerListItem{
			{ID: "exited-container", State: "exited"},
			{ID: "running-container", State: "running"},
		})
	})
	handler.HandleFunc("/containers/exited-container/stats", func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("stats endpoint should not be called for exited containers")
	})
	handler.HandleFunc("/containers/running-container/stats", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(dockerContainerStats{
			CPUStats: dockerCPUStats{
				CPUUsage:       dockerCPUUsage{TotalUsage: 2},
				SystemCPUUsage: 2,
				OnlineCPUs:     1,
			},
			PreCPUStats: dockerCPUStats{
				CPUUsage:       dockerCPUUsage{TotalUsage: 1},
				SystemCPUUsage: 1,
			},
		})
	})
	handler.HandleFunc("/containers/running-container/json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(dockerContainerInspect{})
	})
	server := httptest.NewServer(handler)
	defer server.Close()

	samples, err := collectDockerMetricSamplesWithClient(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("collectDockerMetricSamplesWithClient() error = %v", err)
	}
	if len(samples) != 1 {
		t.Fatalf("samples length = %d, want 1", len(samples))
	}
	if samples[0].DockerContainerId != "running-container" {
		t.Fatalf("sample container = %q, want running-container", samples[0].DockerContainerId)
	}
}

func TestBuildDockerTelemetryBatchesSplitsSamplesAndSetsPayload(t *testing.T) {
	samples := []*agentv1.DockerContainerMetricSample{
		{DockerContainerId: "one", RecordedAtUnix: 1},
		{DockerContainerId: "two", RecordedAtUnix: 2},
		{DockerContainerId: "three", RecordedAtUnix: 3},
	}
	inventory := []*agentv1.DockerContainerInventory{{DockerContainerId: "one"}}

	batches := buildDockerTelemetryBatches("agent-1", 7, inventory, samples, 4, dockerTelemetryLimits{
		maxSamplesPerBatch:   2,
		maxInventoryPerBatch: 10,
		maxBatchBytes:        defaultDockerTelemetryMaxBatchBytes,
	})

	if len(batches) != 2 {
		t.Fatalf("len(batches) = %d, want 2", len(batches))
	}
	if batches[0].BatchId == "" || batches[0].BatchId == batches[1].BatchId {
		t.Fatalf("batch ids were not unique: %q / %q", batches[0].BatchId, batches[1].BatchId)
	}
	if batches[0].AgentId != "agent-1" || batches[0].Sequence != 7 || batches[1].Sequence != 8 {
		t.Fatalf("agent/sequence fields = %q/%d/%d", batches[0].AgentId, batches[0].Sequence, batches[1].Sequence)
	}
	if got := len(batches[0].Inventory); got != 1 {
		t.Fatalf("first batch inventory length = %d, want 1", got)
	}
	if got := len(batches[0].Samples); got != 2 {
		t.Fatalf("first batch sample length = %d, want 2", got)
	}
	if got := len(batches[1].Samples); got != 1 {
		t.Fatalf("second batch sample length = %d, want 1", got)
	}
	if batches[0].DroppedSampleCount != 4 || batches[1].DroppedSampleCount != 0 {
		t.Fatalf("dropped sample counts = %d/%d, want first batch only", batches[0].DroppedSampleCount, batches[1].DroppedSampleCount)
	}
	if batches[0].PayloadBytes == 0 || batches[1].PayloadBytes == 0 {
		t.Fatalf("payload bytes were not set: %d/%d", batches[0].PayloadBytes, batches[1].PayloadBytes)
	}
}

func TestBuildDockerTelemetryBatchesRespectsPayloadBytes(t *testing.T) {
	samples := []*agentv1.DockerContainerMetricSample{
		{DockerContainerId: strings.Repeat("a", 80), RecordedAtUnix: 1},
		{DockerContainerId: strings.Repeat("b", 80), RecordedAtUnix: 2},
	}

	batches := buildDockerTelemetryBatches("agent-1", 1, nil, samples, 0, dockerTelemetryLimits{
		maxSamplesPerBatch:   100,
		maxInventoryPerBatch: 100,
		maxBatchBytes:        150,
	})

	if len(batches) != 2 {
		t.Fatalf("len(batches) = %d, want payload split into 2", len(batches))
	}
	for i, batch := range batches {
		if len(batch.Samples) != 1 {
			t.Fatalf("batch %d has %d samples, want 1", i, len(batch.Samples))
		}
		if batch.PayloadBytes > 150 {
			t.Fatalf("batch %d payload = %d, want <= 150", i, batch.PayloadBytes)
		}
	}
}

func TestDockerMetricBufferDropsOldestSamplesWhenFull(t *testing.T) {
	buffer := newDockerMetricBuffer(2)
	buffer.Add([]*agentv1.DockerContainerMetricSample{
		{DockerContainerId: "one"},
		{DockerContainerId: "two"},
		{DockerContainerId: "three"},
	})

	samples, dropped := buffer.Drain()
	if dropped != 1 {
		t.Fatalf("dropped = %d, want 1", dropped)
	}
	if len(samples) != 2 {
		t.Fatalf("samples length = %d, want 2", len(samples))
	}
	if samples[0].DockerContainerId != "two" || samples[1].DockerContainerId != "three" {
		t.Fatalf("samples = %#v, want newest two", samples)
	}

	if samples, dropped := buffer.Drain(); len(samples) != 0 || dropped != 0 {
		t.Fatalf("second drain = %d samples/%d dropped, want empty", len(samples), dropped)
	}
}

func TestDockerCPUPercentHandlesResetCounters(t *testing.T) {
	got := dockerCPUPercent(
		dockerCPUStats{
			CPUUsage:       dockerCPUUsage{TotalUsage: 10},
			SystemCPUUsage: 10,
			OnlineCPUs:     2,
		},
		dockerCPUStats{
			CPUUsage:       dockerCPUUsage{TotalUsage: 20},
			SystemCPUUsage: 20,
		},
	)
	if got != 0 {
		t.Fatalf("cpu_percent = %v, want 0 for reset counters", got)
	}
}

func TestDockerMetricSamplerUsesDefaultIntervalAndBuffersSamples(t *testing.T) {
	calls := 0
	buffer := newDockerMetricBuffer(4)
	sampler := newDockerMetricSampler(dockerMetricSamplerConfig{}, buffer, func(context.Context) ([]*agentv1.DockerContainerMetricSample, error) {
		calls++
		return []*agentv1.DockerContainerMetricSample{{DockerContainerId: "sample"}}, nil
	})
	if sampler.interval != defaultDockerMetricSampleInterval {
		t.Fatalf("interval = %s, want %s", sampler.interval, defaultDockerMetricSampleInterval)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()
	sampler.interval = 25 * time.Millisecond
	sampler.Run(ctx)

	samples, dropped := buffer.Drain()
	if calls == 0 {
		t.Fatal("collector was not called")
	}
	if dropped != 0 {
		t.Fatalf("dropped = %d, want 0", dropped)
	}
	if len(samples) == 0 {
		t.Fatal("buffer did not receive samples")
	}
}
