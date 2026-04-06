package heartbeat

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"os"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/infrawatch/agent/internal/checks"
	"github.com/infrawatch/agent/internal/updater"
	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// Runner manages the bidirectional heartbeat stream with the ingest service.
type Runner struct {
	client   agentv1.IngestServiceClient
	agentID  string
	jwtToken string
	version  string
	interval time.Duration
	executor *checks.Executor

	// CPU two-sample state
	prevCPUTotal   uint64
	prevCPUIdle    uint64
	prevCPUSampled bool
}

// New creates a new heartbeat Runner.
func New(client agentv1.IngestServiceClient, agentID, jwtToken, version string, intervalSecs int, executor *checks.Executor) *Runner {
	return &Runner{
		client:   client,
		agentID:  agentID,
		jwtToken: jwtToken,
		version:  version,
		interval: time.Duration(intervalSecs) * time.Second,
		executor: executor,
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
	if err := r.sendHeartbeat(ctx, stream); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			_ = stream.CloseSend()
			return ctx.Err()

		case <-ticker.C:
			if err := r.sendHeartbeat(ctx, stream); err != nil {
				return err
			}
		}
	}
}

func (r *Runner) sendHeartbeat(ctx context.Context, stream agentv1.IngestService_HeartbeatClient) error {
	cpu, mem, disk, uptime, osVersion, disks, nets := r.collectMetrics()

	req := &agentv1.HeartbeatRequest{
		AgentId:           r.agentID,
		CpuPercent:        cpu,
		MemoryPercent:     mem,
		DiskPercent:       disk,
		UptimeSeconds:     uptime,
		TimestampUnix:     time.Now().Unix(),
		AgentVersion:      r.version,
		OsVersion:         osVersion,
		Os:                runtime.GOOS,
		Arch:              runtime.GOARCH,
		Disks:             disks,
		NetworkInterfaces: nets,
		CheckResults:      r.executor.DrainResults(),
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
	if len(resp.Checks) > 0 {
		r.executor.UpdateDefinitions(ctx, resp.Checks)
	}
	if resp.UpdateAvailable && resp.DownloadURL != "" {
		slog.Info("agent update available, downloading",
			"current", r.version,
			"latest", resp.LatestVersion,
		)
		if err := updater.Update(resp.LatestVersion, resp.DownloadURL); err != nil {
			// Log and continue — a failed update must never crash the agent.
			slog.Warn("self-update failed, continuing with current version", "err", err)
		}
		// If Update succeeds it re-execs and never returns.
	}

	return nil
}

// collectMetrics gathers all system metrics. Returns best-effort values;
// on unsupported platforms or read errors individual values will be zero/empty.
func (r *Runner) collectMetrics() (cpu, mem, disk float32, uptimeSecs int64, osVersion string, disks []agentv1.DiskInfo, nets []agentv1.NetworkInterface) {
	uptimeSecs = readUptime()
	cpu = r.readCPUPercent()
	mem = readMemPercent()
	disks = readAllDisks()
	osVersion = readOsVersion()
	nets = readNetworkInterfaces()

	// Aggregate disk percent from root mount for backward compatibility
	for _, d := range disks {
		if d.MountPoint == "/" {
			disk = d.PercentUsed
			break
		}
	}
	// If no root mount found, use first disk
	if disk == 0 && len(disks) > 0 {
		disk = disks[0].PercentUsed
	}
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

// readCPUPercent returns the CPU usage percentage using a two-sample delta
// from /proc/stat. Returns 0 on the first call (stores the baseline sample).
func (r *Runner) readCPUPercent() float32 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}

	var user, nice, system, idle, iowait, irq, softirq, steal uint64
	for _, line := range splitLines(string(data)) {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		_, _ = fmt.Sscanf(line, "cpu %d %d %d %d %d %d %d %d",
			&user, &nice, &system, &idle, &iowait, &irq, &softirq, &steal)
		break
	}

	total := user + nice + system + idle + iowait + irq + softirq + steal
	idleTotal := idle + iowait

	if !r.prevCPUSampled {
		r.prevCPUTotal = total
		r.prevCPUIdle = idleTotal
		r.prevCPUSampled = true
		return 0
	}

	totalDelta := total - r.prevCPUTotal
	idleDelta := idleTotal - r.prevCPUIdle

	r.prevCPUTotal = total
	r.prevCPUIdle = idleTotal

	if totalDelta == 0 {
		return 0
	}
	return float32(totalDelta-idleDelta) / float32(totalDelta) * 100
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

// pseudoFSTypes is the set of filesystem types that are not real storage.
var pseudoFSTypes = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "proc": true, "sysfs": true,
	"devpts": true, "cgroup": true, "cgroup2": true, "pstore": true,
	"debugfs": true, "tracefs": true, "securityfs": true, "hugetlbfs": true,
	"mqueue": true, "fusectl": true, "configfs": true, "ramfs": true,
	"bpf": true, "overlay": true, "squashfs": true, "nsfs": true,
}

// readAllDisks reads /proc/mounts and calls syscall.Statfs on each real filesystem.
func readAllDisks() []agentv1.DiskInfo {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var result []agentv1.DiskInfo

	for _, line := range splitLines(string(data)) {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		device, mountPoint, fsType := fields[0], fields[1], fields[2]

		if pseudoFSTypes[fsType] {
			continue
		}
		if seen[mountPoint] {
			continue
		}
		seen[mountPoint] = true

		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountPoint, &stat); err != nil {
			continue
		}
		if stat.Blocks == 0 {
			continue
		}

		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bfree * uint64(stat.Bsize)
		used := total - free
		var pct float32
		if total > 0 {
			pct = float32(used) / float32(total) * 100
		}

		result = append(result, agentv1.DiskInfo{
			MountPoint:  mountPoint,
			Device:      device,
			FsType:      fsType,
			TotalBytes:  total,
			UsedBytes:   used,
			FreeBytes:   free,
			PercentUsed: pct,
		})
	}
	return result
}

// readOsVersion parses /etc/os-release for the PRETTY_NAME field.
func readOsVersion() string {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return ""
	}
	for _, line := range splitLines(string(data)) {
		if !strings.HasPrefix(line, "PRETTY_NAME=") {
			continue
		}
		val := strings.TrimPrefix(line, "PRETTY_NAME=")
		val = strings.Trim(val, `"`)
		return val
	}
	return ""
}

// readNetworkInterfaces collects non-loopback network interfaces.
func readNetworkInterfaces() []agentv1.NetworkInterface {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	var result []agentv1.NetworkInterface
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		var ips []string
		for _, addr := range addrs {
			// addr.String() returns CIDR notation; extract just the IP
			ip, _, err := net.ParseCIDR(addr.String())
			if err != nil {
				continue
			}
			ips = append(ips, ip.String())
		}

		result = append(result, agentv1.NetworkInterface{
			Name:        iface.Name,
			IpAddresses: ips,
			MacAddress:  iface.HardwareAddr.String(),
			IsUp:        iface.Flags&net.FlagUp != 0,
		})
	}
	return result
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
