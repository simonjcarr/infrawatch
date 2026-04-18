package loadtest

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Stats aggregates run-wide counters and latency samples. All operations are
// safe for concurrent use.
type Stats struct {
	RegistrationsStarted atomic.Int64
	RegistrationsActive  atomic.Int64
	RegistrationsPending atomic.Int64
	RegistrationsFailed  atomic.Int64
	StreamsOpen          atomic.Int64
	Reconnects           atomic.Int64
	HeartbeatsSent       atomic.Int64
	HeartbeatsFailed     atomic.Int64
	TasksCompleted       atomic.Int64
	ChecksReported       atomic.Int64
	QueriesAnswered      atomic.Int64
	TerminalSessions     atomic.Int64
	InventoryScans       atomic.Int64
	BytesSent            atomic.Int64

	mu            sync.Mutex
	sendLatencyUs []int64
	rttUs         []int64
	errorCounts   map[string]int

	start time.Time
}

// NewStats initialises an empty Stats.
func NewStats() *Stats {
	return &Stats{
		sendLatencyUs: make([]int64, 0, 4096),
		rttUs:         make([]int64, 0, 1024),
		errorCounts:   make(map[string]int),
		start:         time.Now(),
	}
}

// RecordSendLatency records the microsecond duration of a single stream.Send
// call. Sampling is unbounded per interval; the slice is reset on each call to
// snapshotLatencies.
func (s *Stats) RecordSendLatency(d time.Duration) {
	s.mu.Lock()
	s.sendLatencyUs = append(s.sendLatencyUs, d.Microseconds())
	s.mu.Unlock()
}

// RecordRTT records the observed server-round-trip time for a single request
// that has a correlated response (we only do this for the first heartbeat of
// each stream — the streaming RPC has no request/response correlation ID).
func (s *Stats) RecordRTT(d time.Duration) {
	s.mu.Lock()
	s.rttUs = append(s.rttUs, d.Microseconds())
	s.mu.Unlock()
}

// RecordError bumps the distinct-error counter. The first 10 distinct error
// strings are kept in the final summary.
func (s *Stats) RecordError(msg string) {
	s.mu.Lock()
	s.errorCounts[msg]++
	s.mu.Unlock()
}

type percentileSnapshot struct {
	count int
	p50   int64
	p90   int64
	p95   int64
	p99   int64
	p999  int64
}

func (s *Stats) snapshotLatencies() (send, rtt percentileSnapshot) {
	s.mu.Lock()
	sendSamples := s.sendLatencyUs
	rttSamples := s.rttUs
	s.sendLatencyUs = make([]int64, 0, 4096)
	s.rttUs = make([]int64, 0, 1024)
	s.mu.Unlock()

	return computePercentiles(sendSamples), computePercentiles(rttSamples)
}

func computePercentiles(samples []int64) percentileSnapshot {
	if len(samples) == 0 {
		return percentileSnapshot{}
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	pick := func(p float64) int64 {
		idx := int(float64(len(samples)-1) * p)
		return samples[idx]
	}
	return percentileSnapshot{
		count: len(samples),
		p50:   pick(0.50),
		p90:   pick(0.90),
		p95:   pick(0.95),
		p99:   pick(0.99),
		p999:  pick(0.999),
	}
}

// PrintInterval emits a one-line running snapshot. Called on a ticker driven
// by --stats-interval.
func (s *Stats) PrintInterval(w io.Writer, total int) {
	elapsed := time.Since(s.start).Round(time.Second)
	active := s.RegistrationsActive.Load()
	hbSent := s.HeartbeatsSent.Load()
	hbFail := s.HeartbeatsFailed.Load()
	streamsOpen := s.StreamsOpen.Load()
	reconns := s.Reconnects.Load()
	bytes := s.BytesSent.Load()

	sendPct, rttPct := s.snapshotLatencies()

	fmt.Fprintf(w, "[t+%s] agents: %d/%d active | streams: %d | hb_sent: %d | failed: %d\n",
		elapsed, active, total, streamsOpen, hbSent, hbFail)
	fmt.Fprintf(w, "        send_latency p50=%s p95=%s p99=%s (n=%d) | rtt p50=%s p95=%s (n=%d)\n",
		fmtUs(sendPct.p50), fmtUs(sendPct.p95), fmtUs(sendPct.p99), sendPct.count,
		fmtUs(rttPct.p50), fmtUs(rttPct.p95), rttPct.count)
	fmt.Fprintf(w, "        reconnects: %d | bytes_sent: %s | tasks: %d | checks: %d | queries: %d\n",
		reconns, fmtBytes(bytes),
		s.TasksCompleted.Load(), s.ChecksReported.Load(), s.QueriesAnswered.Load())
}

// FinalSummary holds the complete run statistics, suitable for JSON dump or
// human-readable printing.
type FinalSummary struct {
	RunID                string            `json:"run_id"`
	StartedAt            time.Time         `json:"started_at"`
	Duration             time.Duration     `json:"duration"`
	TargetAgents         int               `json:"target_agents"`
	RegistrationsStarted int64             `json:"registrations_started"`
	RegistrationsActive  int64             `json:"registrations_active"`
	RegistrationsPending int64             `json:"registrations_pending"`
	RegistrationsFailed  int64             `json:"registrations_failed"`
	Reconnects           int64             `json:"reconnects"`
	HeartbeatsSent       int64             `json:"heartbeats_sent"`
	HeartbeatsFailed     int64             `json:"heartbeats_failed"`
	TasksCompleted       int64             `json:"tasks_completed"`
	ChecksReported       int64             `json:"checks_reported"`
	QueriesAnswered      int64             `json:"queries_answered"`
	TerminalSessions     int64             `json:"terminal_sessions"`
	InventoryScans       int64             `json:"inventory_scans"`
	BytesSent            int64             `json:"bytes_sent"`
	SendLatencyP50Us     int64             `json:"send_latency_p50_us"`
	SendLatencyP90Us     int64             `json:"send_latency_p90_us"`
	SendLatencyP95Us     int64             `json:"send_latency_p95_us"`
	SendLatencyP99Us     int64             `json:"send_latency_p99_us"`
	SendLatencyP999Us    int64             `json:"send_latency_p999_us"`
	RTTP50Us             int64             `json:"rtt_p50_us"`
	RTTP95Us             int64             `json:"rtt_p95_us"`
	TopErrors            map[string]int    `json:"top_errors"`
}

// Finalise produces the run summary and prints it to w. If outputPath is
// non-empty the summary is also written as JSON to that file.
func (s *Stats) Finalise(w io.Writer, runID string, targetAgents int, outputPath string) {
	send, rtt := s.snapshotLatencies()
	summary := FinalSummary{
		RunID:                runID,
		StartedAt:            s.start,
		Duration:             time.Since(s.start),
		TargetAgents:         targetAgents,
		RegistrationsStarted: s.RegistrationsStarted.Load(),
		RegistrationsActive:  s.RegistrationsActive.Load(),
		RegistrationsPending: s.RegistrationsPending.Load(),
		RegistrationsFailed:  s.RegistrationsFailed.Load(),
		Reconnects:           s.Reconnects.Load(),
		HeartbeatsSent:       s.HeartbeatsSent.Load(),
		HeartbeatsFailed:     s.HeartbeatsFailed.Load(),
		TasksCompleted:       s.TasksCompleted.Load(),
		ChecksReported:       s.ChecksReported.Load(),
		QueriesAnswered:      s.QueriesAnswered.Load(),
		TerminalSessions:     s.TerminalSessions.Load(),
		InventoryScans:       s.InventoryScans.Load(),
		BytesSent:            s.BytesSent.Load(),
		SendLatencyP50Us:     send.p50,
		SendLatencyP90Us:     send.p90,
		SendLatencyP95Us:     send.p95,
		SendLatencyP99Us:     send.p99,
		SendLatencyP999Us:    send.p999,
		RTTP50Us:             rtt.p50,
		RTTP95Us:             rtt.p95,
		TopErrors:            s.topErrors(10),
	}

	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "=== Load test summary ===")
	fmt.Fprintf(w, "run_id:              %s\n", summary.RunID)
	fmt.Fprintf(w, "duration:            %s\n", summary.Duration.Round(time.Second))
	fmt.Fprintf(w, "agents:              %d active / %d target\n", summary.RegistrationsActive, summary.TargetAgents)
	fmt.Fprintf(w, "registrations:       started=%d active=%d pending=%d failed=%d\n",
		summary.RegistrationsStarted, summary.RegistrationsActive, summary.RegistrationsPending, summary.RegistrationsFailed)
	fmt.Fprintf(w, "heartbeats:          sent=%d failed=%d reconnects=%d\n",
		summary.HeartbeatsSent, summary.HeartbeatsFailed, summary.Reconnects)
	fmt.Fprintf(w, "tasks/checks:        tasks=%d checks=%d queries=%d terminal=%d inventory=%d\n",
		summary.TasksCompleted, summary.ChecksReported, summary.QueriesAnswered, summary.TerminalSessions, summary.InventoryScans)
	fmt.Fprintf(w, "send_latency_us:     p50=%d p90=%d p95=%d p99=%d p99.9=%d\n",
		summary.SendLatencyP50Us, summary.SendLatencyP90Us, summary.SendLatencyP95Us,
		summary.SendLatencyP99Us, summary.SendLatencyP999Us)
	fmt.Fprintf(w, "rtt_us:              p50=%d p95=%d\n", summary.RTTP50Us, summary.RTTP95Us)
	fmt.Fprintf(w, "bytes_sent:          %s\n", fmtBytes(summary.BytesSent))

	if len(summary.TopErrors) > 0 {
		fmt.Fprintln(w, "top_errors:")
		for msg, count := range summary.TopErrors {
			fmt.Fprintf(w, "  [%d] %s\n", count, msg)
		}
	}

	if outputPath != "" {
		data, err := json.MarshalIndent(summary, "", "  ")
		if err != nil {
			fmt.Fprintf(w, "failed to marshal JSON summary: %v\n", err)
			return
		}
		if err := os.WriteFile(outputPath, data, 0o644); err != nil {
			fmt.Fprintf(w, "failed to write JSON summary to %s: %v\n", outputPath, err)
			return
		}
		fmt.Fprintf(w, "json_summary:        %s\n", outputPath)
	}
}

func (s *Stats) topErrors(n int) map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()

	type kv struct {
		msg   string
		count int
	}
	entries := make([]kv, 0, len(s.errorCounts))
	for m, c := range s.errorCounts {
		entries = append(entries, kv{m, c})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].count > entries[j].count })
	if len(entries) > n {
		entries = entries[:n]
	}
	out := make(map[string]int, len(entries))
	for _, e := range entries {
		out[e.msg] = e.count
	}
	return out
}

func fmtUs(us int64) string {
	if us == 0 {
		return "-"
	}
	if us < 1000 {
		return fmt.Sprintf("%dus", us)
	}
	if us < 1_000_000 {
		return fmt.Sprintf("%.1fms", float64(us)/1000)
	}
	return fmt.Sprintf("%.1fs", float64(us)/1_000_000)
}

func fmtBytes(n int64) string {
	const (
		KB = 1024
		MB = 1024 * KB
		GB = 1024 * MB
	)
	switch {
	case n >= GB:
		return fmt.Sprintf("%.1f GB", float64(n)/float64(GB))
	case n >= MB:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(MB))
	case n >= KB:
		return fmt.Sprintf("%.1f KB", float64(n)/float64(KB))
	default:
		return fmt.Sprintf("%d B", n)
	}
}
