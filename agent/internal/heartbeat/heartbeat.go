package heartbeat

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// Runner manages the bidirectional heartbeat stream with the ingest service.
type Runner struct {
	client   agentv1.IngestServiceClient
	agentID  string
	jwtToken string
	interval time.Duration
}

// New creates a new heartbeat Runner.
func New(client agentv1.IngestServiceClient, agentID, jwtToken string, intervalSecs int) *Runner {
	return &Runner{
		client:   client,
		agentID:  agentID,
		jwtToken: jwtToken,
		interval: time.Duration(intervalSecs) * time.Second,
	}
}

// Run starts the heartbeat stream. It reconnects automatically on transient
// errors, backing off up to 60 seconds between attempts.
func (r *Runner) Run(ctx context.Context) error {
	backoff := time.Second
	maxBackoff := 60 * time.Second

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		err := r.runStream(ctx)
		if err == nil || err == context.Canceled || err == context.DeadlineExceeded {
			return err
		}

		slog.Warn("heartbeat stream ended, reconnecting", "err", err, "backoff", backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		backoff = time.Duration(math.Min(float64(backoff*2), float64(maxBackoff)))
	}
}

func (r *Runner) runStream(ctx context.Context) error {
	stream, err := r.client.Heartbeat(ctx)
	if err != nil {
		return fmt.Errorf("opening heartbeat stream: %w", err)
	}

	slog.Info("heartbeat stream opened", "agent_id", r.agentID)

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	// Send first heartbeat immediately
	if err := r.sendHeartbeat(stream); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			_ = stream.CloseSend()
			return ctx.Err()

		case <-ticker.C:
			if err := r.sendHeartbeat(stream); err != nil {
				return err
			}
		}
	}
}

func (r *Runner) sendHeartbeat(stream agentv1.IngestService_HeartbeatClient) error {
	cpu, mem, disk, uptime := collectMetrics()

	req := &agentv1.HeartbeatRequest{
		AgentId:       r.agentID,
		CpuPercent:    cpu,
		MemoryPercent: mem,
		DiskPercent:   disk,
		UptimeSeconds: uptime,
		TimestampUnix: time.Now().Unix(),
	}

	if err := stream.Send(req); err != nil {
		return fmt.Errorf("sending heartbeat: %w", err)
	}

	resp, err := stream.Recv()
	if err == io.EOF {
		return fmt.Errorf("server closed heartbeat stream")
	}
	if err != nil {
		return fmt.Errorf("receiving heartbeat response: %w", err)
	}

	if !resp.Ok {
		slog.Warn("heartbeat rejected by server")
	}
	if resp.Command != "" {
		slog.Info("received server command", "command", resp.Command)
	}

	return nil
}

// collectMetrics reads basic system metrics using /proc on Linux.
// Returns best-effort values; on unsupported platforms returns zeros.
func collectMetrics() (cpu, mem, disk float32, uptimeSecs int64) {
	uptimeSecs = readUptime()
	cpu = readCPUPercent()
	mem = readMemPercent()
	disk = readDiskPercent("/")
	return
}

func readUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	var upSecs float64
	_, _ = fmt.Sscanf(string(data), "%f", &upSecs)
	return int64(upSecs)
}

func readCPUPercent() float32 {
	// Simple single-sample CPU % from /proc/stat is not meaningful without
	// two samples. Return 0 until a proper two-sample collector is added.
	return 0
}

func readMemPercent() float32 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	var total, available uint64
	for _, line := range splitLines(string(data)) {
		var key string
		var val uint64
		_, _ = fmt.Sscanf(line, "%s %d", &key, &val)
		switch key {
		case "MemTotal:":
			total = val
		case "MemAvailable:":
			available = val
		}
	}
	if total == 0 {
		return 0
	}
	used := total - available
	return float32(used) / float32(total) * 100
}

func readDiskPercent(path string) float32 {
	// syscall.Statfs is not available on all platforms via this package.
	// A full implementation will use golang.org/x/sys/unix.Statfs.
	return 0
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	return lines
}
