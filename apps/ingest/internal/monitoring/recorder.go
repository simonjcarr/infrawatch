package monitoring

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"os"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Version is set by cmd/ingest so snapshots identify the deployed ingest build.
var Version = "dev"

// QueueStatsProvider is implemented by queue publishers that can expose their
// current buffer depth without coupling monitoring to a concrete queue type.
type QueueStatsProvider interface {
	Len() int
	Cap() int
}

// Recorder tracks process-local ingest activity with cheap atomic counters.
type Recorder struct {
	serverID string
	hostname string
	pid      int
	started  time.Time
	queue    QueueStatsProvider

	activeRequests   atomic.Int64
	messagesReceived atomic.Uint64
}

// NewRecorder returns a process recorder. CT_OPS_INGEST_SERVER_ID can be used
// to make the server identity stable across container restarts.
func NewRecorder(queue QueueStatsProvider) *Recorder {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "unknown"
	}
	started := time.Now()
	pid := os.Getpid()
	serverID := os.Getenv("CT_OPS_INGEST_SERVER_ID")
	if serverID == "" {
		serverID = fmt.Sprintf("%s-%d-%d", hostname, pid, started.Unix())
	}
	return &Recorder{
		serverID: serverID,
		hostname: hostname,
		pid:      pid,
		started:  started,
		queue:    queue,
	}
}

func (r *Recorder) BeginRequest() func() {
	if r == nil {
		return func() {}
	}
	r.activeRequests.Add(1)
	return func() {
		r.activeRequests.Add(-1)
	}
}

func (r *Recorder) RecordMessageReceived() {
	if r != nil {
		r.messagesReceived.Add(1)
	}
}

// RunStatusReporter writes ingest health snapshots until ctx is cancelled.
func (r *Recorder) RunStatusReporter(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	if r == nil || pool == nil {
		return
	}
	if interval <= 0 {
		interval = 30 * time.Second
	}
	r.writeSnapshot(ctx, pool)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.writeSnapshot(ctx, pool)
		}
	}
}

func (r *Recorder) writeSnapshot(ctx context.Context, pool *pgxpool.Pool) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	queueDepth := 0
	queueCapacity := 0
	if r.queue != nil {
		queueDepth = r.queue.Len()
		queueCapacity = r.queue.Cap()
	}
	stats := pool.Stat()

	const q = `
		INSERT INTO ingest_server_snapshots (
			id, server_id, hostname, process_id, version, started_at, observed_at,
			active_requests, messages_received_total, queue_depth, queue_capacity,
			goroutines, heap_alloc_bytes, heap_sys_bytes, db_open_connections,
			db_acquired_connections, gc_pause_total_ns
		)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	`
	_, err := pool.Exec(ctx, q,
		newCUID(),
		r.serverID,
		r.hostname,
		r.pid,
		Version,
		r.started,
		int(r.activeRequests.Load()),
		int64(r.messagesReceived.Load()),
		queueDepth,
		queueCapacity,
		runtime.NumGoroutine(),
		int64(mem.HeapAlloc),
		int64(mem.HeapSys),
		int(stats.TotalConns()),
		int(stats.AcquiredConns()),
		int64(mem.PauseTotalNs),
	)
	if err != nil {
		slog.Warn("writing ingest status snapshot", "err", err)
		return
	}

	_, err = pool.Exec(ctx, `
		DELETE FROM ingest_server_snapshots
		WHERE observed_at < NOW() - INTERVAL '7 days'
	`)
	if err != nil {
		slog.Warn("purging old ingest status snapshots", "err", err)
	}
}

// newCUID generates a compact random ID compatible with web-generated cuid2 IDs.
func newCUID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	for i, b := range buf {
		buf[i] = chars[int(b)%len(chars)]
	}
	return string(buf)
}
