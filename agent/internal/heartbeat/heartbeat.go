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
	"sync"
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

	// Buffered ad-hoc query results, drained on each heartbeat send.
	queryResultsMu sync.Mutex
	queryResults   []agentv1.AgentQueryResult

	// Dedupes server-pushed queries: the ingest handler may re-push the same
	// query on consecutive 2s poll ticks while the agent is still executing it.
	seenMu       sync.Mutex
	seenQueryIDs map[string]struct{}

	// Signalled when new query results are ready so the send loop can fire
	// an immediate heartbeat rather than waiting for the next 30s tick.
	resultsReady chan struct{}
}

// New creates a new heartbeat Runner.
func New(client agentv1.IngestServiceClient, agentID, jwtToken, version string, intervalSecs int, executor *checks.Executor) *Runner {
	return &Runner{
		client:       client,
		agentID:      agentID,
		jwtToken:     jwtToken,
		version:      version,
		interval:     time.Duration(intervalSecs) * time.Second,
		executor:     executor,
		seenQueryIDs: make(map[string]struct{}),
		resultsReady: make(chan struct{}, 1),
	}
}

// Run starts the heartbeat stream. It reconnects automatically on transient
// errors, backing off up to 60 seconds between attempts. The backoff resets
// to 1s after any stream that ran stably for at least minStableTime, so a
// transient blip (e.g. firewall state expiry) does not leave the agent
// waiting 60s between retries on the next failure.
func (r *Runner) Run(ctx context.Context) error {
	const minStableTime = 10 * time.Second
	backoff := time.Second
	maxBackoff := 60 * time.Second

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		start := time.Now()
		err := r.runStream(ctx)
		if err == nil || err == context.Canceled || err == context.DeadlineExceeded {
			return err
		}

		if time.Since(start) >= minStableTime {
			backoff = time.Second // stream was stable — reset backoff
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

	// Reset the dedup map per stream session. Queries pushed on a previous
	// (now-dead) stream will be re-pushed by the server on reconnect and must
	// be re-executed; keeping stale IDs would silently drop them.
	r.seenMu.Lock()
	r.seenQueryIDs = make(map[string]struct{})
	r.seenMu.Unlock()

	slog.Info("heartbeat stream opened", "agent_id", r.agentID)

	// Background receiver: the server pushes HeartbeatResponses both as
	// replies to our heartbeats and proactively when queries arrive, so we
	// cannot call stream.Recv() inline in sendHeartbeat. Run it in its own
	// goroutine and signal the send loop via recvErr on failure.
	streamCtx, cancelRecv := context.WithCancel(ctx)
	defer cancelRecv()
	recvErr := make(chan error, 1)
	go r.runReceiver(streamCtx, stream, recvErr)

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

		case err := <-recvErr:
			_ = stream.CloseSend()
			return err

		case <-ticker.C:
			if err := r.sendHeartbeat(stream); err != nil {
				return err
			}

		case <-r.resultsReady:
			// A query result is waiting — fire an immediate heartbeat rather
			// than making the user wait up to 30s for the next tick.
			if err := r.sendHeartbeat(stream); err != nil {
				return err
			}
		}
	}
}

// runReceiver reads HeartbeatResponses from the stream in a loop and dispatches
// their contents. It exits (and signals recvErr) on any stream error.
func (r *Runner) runReceiver(
	ctx context.Context,
	stream agentv1.IngestService_HeartbeatClient,
	recvErr chan<- error,
) {
	for {
		resp, err := stream.Recv()
		if err == io.EOF {
			recvErr <- fmt.Errorf("server closed heartbeat stream")
			return
		}
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			recvErr <- fmt.Errorf("receiving heartbeat response: %w", err)
			return
		}
		r.handleResponse(ctx, resp)
	}
}

// handleResponse processes a single HeartbeatResponse from the server.
func (r *Runner) handleResponse(ctx context.Context, resp *agentv1.HeartbeatResponse) {
	if !resp.Ok {
		slog.Warn("heartbeat rejected by server")
	}
	if resp.Command != "" {
		slog.Info("received server command", "command", resp.Command)
	}
	if len(resp.Checks) > 0 {
		r.executor.UpdateDefinitions(ctx, resp.Checks)
	}
	if len(resp.PendingQueries) > 0 {
		// Run queries in a goroutine so the receive loop is never blocked by
		// a slow subprocess. Dedupe against in-flight / already-completed IDs.
		fresh := r.filterUnseenQueries(resp.PendingQueries)
		if len(fresh) > 0 {
			go r.executeQueries(fresh)
		}
	}
	if resp.UpdateAvailable && resp.DownloadURL != "" {
		slog.Info("agent update available, downloading",
			"current", r.version,
			"latest", resp.LatestVersion,
		)
		if err := updater.Update(resp.LatestVersion, resp.DownloadURL); err != nil {
			slog.Warn("self-update failed, continuing with current version", "err", err)
		}
		// If Update succeeds it re-execs and never returns.
	}
}

// filterUnseenQueries returns queries not yet seen for this stream's lifetime.
func (r *Runner) filterUnseenQueries(queries []agentv1.AgentQuery) []agentv1.AgentQuery {
	r.seenMu.Lock()
	defer r.seenMu.Unlock()
	out := make([]agentv1.AgentQuery, 0, len(queries))
	for _, q := range queries {
		if _, dup := r.seenQueryIDs[q.QueryID]; dup {
			continue
		}
		r.seenQueryIDs[q.QueryID] = struct{}{}
		out = append(out, q)
	}
	return out
}

// executeQueries runs each query, buffers the result, and nudges the send loop
// to fire an immediate heartbeat with the results.
func (r *Runner) executeQueries(queries []agentv1.AgentQuery) {
	for _, q := range queries {
		slog.Info("executing agent query", "query_id", q.QueryID, "type", q.QueryType)
		result := checks.RunQuery(q)
		r.queryResultsMu.Lock()
		r.queryResults = append(r.queryResults, result)
		r.queryResultsMu.Unlock()
		slog.Info("agent query completed",
			"query_id", q.QueryID,
			"type", q.QueryType,
			"status", result.Status,
		)
	}
	// Non-blocking nudge — the channel has capacity 1, so if a nudge is
	// already pending the send loop will pick up both batches on one wake.
	select {
	case r.resultsReady <- struct{}{}:
	default:
	}
}

// drainQueryResults atomically returns and clears all buffered query results.
func (r *Runner) drainQueryResults() []agentv1.AgentQueryResult {
	r.queryResultsMu.Lock()
	defer r.queryResultsMu.Unlock()
	results := r.queryResults
	r.queryResults = nil
	return results
}

func (r *Runner) sendHeartbeat(stream agentv1.IngestService_HeartbeatClient) error {
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
		QueryResults:      r.drainQueryResults(),
	}

	if err := stream.Send(req); err != nil {
		return fmt.Errorf("sending heartbeat: %w", err)
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
