package heartbeat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const (
	dockerMetricStatsTimeout          = 5 * time.Second
	defaultDockerMetricSampleInterval = 2 * time.Second
	defaultDockerMetricBufferSamples  = 10_000
)

type dockerMetricCollector func(context.Context) ([]*agentv1.DockerContainerMetricSample, error)

type dockerMetricSamplerConfig struct {
	SampleInterval time.Duration
}

type dockerMetricSampler struct {
	interval  time.Duration
	buffer    *dockerMetricBuffer
	collector dockerMetricCollector
}

type dockerMetricBuffer struct {
	mu      sync.Mutex
	max     int
	samples []*agentv1.DockerContainerMetricSample
	dropped uint32
}

type dockerContainerStats struct {
	CPUStats    dockerCPUStats                `json:"cpu_stats"`
	PreCPUStats dockerCPUStats                `json:"precpu_stats"`
	MemoryStats dockerMemoryStats             `json:"memory_stats"`
	Networks    map[string]dockerNetworkStats `json:"networks"`
	BlkioStats  dockerBlkioStats              `json:"blkio_stats"`
	PidsStats   dockerPidsStats               `json:"pids_stats"`
}

type dockerCPUStats struct {
	CPUUsage       dockerCPUUsage `json:"cpu_usage"`
	SystemCPUUsage uint64         `json:"system_cpu_usage"`
	OnlineCPUs     uint32         `json:"online_cpus"`
}

type dockerCPUUsage struct {
	TotalUsage  uint64   `json:"total_usage"`
	PercpuUsage []uint64 `json:"percpu_usage"`
}

type dockerMemoryStats struct {
	Usage uint64            `json:"usage"`
	Limit uint64            `json:"limit"`
	Stats map[string]uint64 `json:"stats"`
}

type dockerNetworkStats struct {
	RxBytes uint64 `json:"rx_bytes"`
	TxBytes uint64 `json:"tx_bytes"`
}

type dockerBlkioStats struct {
	IoServiceBytesRecursive []dockerBlkioServiceBytes `json:"io_service_bytes_recursive"`
}

type dockerBlkioServiceBytes struct {
	Op    string `json:"op"`
	Value uint64 `json:"value"`
}

type dockerPidsStats struct {
	Current uint32 `json:"current"`
}

func newDockerMetricBuffer(maxSamples int) *dockerMetricBuffer {
	if maxSamples <= 0 {
		maxSamples = defaultDockerMetricBufferSamples
	}
	return &dockerMetricBuffer{max: maxSamples}
}

func (b *dockerMetricBuffer) Add(samples []*agentv1.DockerContainerMetricSample) {
	if b == nil || len(samples) == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	for _, sample := range samples {
		if sample == nil {
			continue
		}
		if len(b.samples) >= b.max {
			copy(b.samples, b.samples[1:])
			b.samples[len(b.samples)-1] = sample
			b.dropped++
			continue
		}
		b.samples = append(b.samples, sample)
	}
}

func (b *dockerMetricBuffer) Drain() ([]*agentv1.DockerContainerMetricSample, uint32) {
	if b == nil {
		return nil, 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	samples := b.samples
	dropped := b.dropped
	b.samples = nil
	b.dropped = 0
	return samples, dropped
}

func newDockerMetricSampler(config dockerMetricSamplerConfig, buffer *dockerMetricBuffer, collector dockerMetricCollector) *dockerMetricSampler {
	interval := config.SampleInterval
	if interval <= 0 {
		interval = defaultDockerMetricSampleInterval
	}
	return &dockerMetricSampler{
		interval:  interval,
		buffer:    buffer,
		collector: collector,
	}
}

func (s *dockerMetricSampler) Run(ctx context.Context) {
	if s == nil || s.buffer == nil || s.collector == nil {
		return
	}
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			samples, err := s.collector(ctx)
			if err == nil {
				s.buffer.Add(samples)
			}
		}
	}
}

func collectDockerMetricSamples(ctx context.Context, socketPath string) ([]*agentv1.DockerContainerMetricSample, error) {
	ctx, cancel := context.WithTimeout(ctx, dockerMetricStatsTimeout)
	defer cancel()
	return collectDockerMetricSamplesWithClient(ctx, dockerSocketHTTPClient(socketPath), "http://docker")
}

func collectDockerMetricSamplesWithClient(ctx context.Context, client *http.Client, baseURL string) ([]*agentv1.DockerContainerMetricSample, error) {
	containers, err := listDockerContainersForMetrics(ctx, client, baseURL)
	if err != nil {
		return nil, err
	}

	recordedAt := time.Now().Unix()
	samples := make([]*agentv1.DockerContainerMetricSample, 0, len(containers))
	for _, container := range containers {
		containerID := truncateUTF8(strings.TrimSpace(container.ID), maxDockerContainerIDBytes)
		if containerID == "" {
			continue
		}
		stats, err := fetchDockerContainerStats(ctx, client, baseURL, containerID)
		if err != nil {
			continue
		}
		sample := dockerMetricSampleFromStats(containerID, recordedAt, stats)
		if inspect, err := inspectDockerContainer(ctx, client, baseURL, containerID); err == nil {
			sample.RestartCount = inspect.RestartCount
		}
		samples = append(samples, sample)
	}
	return samples, nil
}

func listDockerContainersForMetrics(ctx context.Context, client *http.Client, baseURL string) ([]dockerContainerListItem, error) {
	listURL, err := url.JoinPath(baseURL, "/containers/json")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL+"?all=1", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, os.ErrPermission
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("docker containers endpoint returned HTTP %d", resp.StatusCode)
	}

	var containers []dockerContainerListItem
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return nil, err
	}
	return containers, nil
}

func fetchDockerContainerStats(ctx context.Context, client *http.Client, baseURL, containerID string) (dockerContainerStats, error) {
	statsURL, err := url.JoinPath(baseURL, "/containers", containerID, "stats")
	if err != nil {
		return dockerContainerStats{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, statsURL+"?stream=false", nil)
	if err != nil {
		return dockerContainerStats{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return dockerContainerStats{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return dockerContainerStats{}, os.ErrPermission
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return dockerContainerStats{}, fmt.Errorf("docker stats endpoint returned HTTP %d", resp.StatusCode)
	}

	var stats dockerContainerStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return dockerContainerStats{}, err
	}
	return stats, nil
}

func dockerMetricSampleFromStats(containerID string, recordedAt int64, stats dockerContainerStats) *agentv1.DockerContainerMetricSample {
	memoryUsage := dockerMemoryUsageBytes(stats.MemoryStats)
	return &agentv1.DockerContainerMetricSample{
		DockerContainerId: containerID,
		RecordedAtUnix:    recordedAt,
		CpuPercent:        dockerCPUPercent(stats.CPUStats, stats.PreCPUStats),
		MemoryUsageBytes:  memoryUsage,
		MemoryLimitBytes:  stats.MemoryStats.Limit,
		MemoryPercent:     dockerMemoryPercent(memoryUsage, stats.MemoryStats.Limit),
		NetworkRxBytes:    dockerNetworkRxBytes(stats.Networks),
		NetworkTxBytes:    dockerNetworkTxBytes(stats.Networks),
		BlockReadBytes:    dockerBlockBytes(stats.BlkioStats, "read"),
		BlockWriteBytes:   dockerBlockBytes(stats.BlkioStats, "write"),
		PidsCurrent:       stats.PidsStats.Current,
	}
}

func dockerCPUPercent(current, previous dockerCPUStats) float64 {
	if current.CPUUsage.TotalUsage < previous.CPUUsage.TotalUsage || current.SystemCPUUsage < previous.SystemCPUUsage {
		return 0
	}
	cpuDelta := current.CPUUsage.TotalUsage - previous.CPUUsage.TotalUsage
	systemDelta := current.SystemCPUUsage - previous.SystemCPUUsage
	if cpuDelta == 0 || systemDelta == 0 {
		return 0
	}
	onlineCPUs := current.OnlineCPUs
	if onlineCPUs == 0 {
		onlineCPUs = uint32(len(current.CPUUsage.PercpuUsage))
	}
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}
	return (float64(cpuDelta) / float64(systemDelta)) * float64(onlineCPUs) * 100
}

func dockerMemoryUsageBytes(stats dockerMemoryStats) uint64 {
	cache := stats.Stats["cache"]
	if cache > stats.Usage {
		return 0
	}
	return stats.Usage - cache
}

func dockerMemoryPercent(usage, limit uint64) float64 {
	if usage == 0 || limit == 0 {
		return 0
	}
	return (float64(usage) / float64(limit)) * 100
}

func dockerNetworkRxBytes(networks map[string]dockerNetworkStats) uint64 {
	var total uint64
	for _, network := range networks {
		total += network.RxBytes
	}
	return total
}

func dockerNetworkTxBytes(networks map[string]dockerNetworkStats) uint64 {
	var total uint64
	for _, network := range networks {
		total += network.TxBytes
	}
	return total
}

func dockerBlockBytes(stats dockerBlkioStats, op string) uint64 {
	var total uint64
	for _, entry := range stats.IoServiceBytesRecursive {
		if strings.EqualFold(entry.Op, op) {
			total += entry.Value
		}
	}
	return total
}
