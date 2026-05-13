package heartbeat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

func TestCollectDockerMetricSamplesCalculatesStats(t *testing.T) {
	handler := http.NewServeMux()
	handler.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("all") != "1" {
			t.Fatalf("all query = %q, want 1", r.URL.Query().Get("all"))
		}
		_ = json.NewEncoder(w).Encode([]dockerContainerListItem{
			{ID: "abcdef123456"},
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
