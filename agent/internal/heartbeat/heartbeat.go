package heartbeat

import (
	"context"
	"errors"
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
	"unicode/utf8"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/carrtech-dev/ct-ops/agent/internal/checks"
	"github.com/carrtech-dev/ct-ops/agent/internal/identity"
	"github.com/carrtech-dev/ct-ops/agent/internal/tasks"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

// ErrAgentDeregistered is returned when the server rejects the agent with
// NotFound or PermissionDenied, signalling that the local state should be
// cleared and the agent should re-register from scratch.
var ErrAgentDeregistered = errors.New("agent deregistered by server — re-registration required")

const (
	maxBufferedTaskProgressBytesPerTask     = 64 * 1024
	maxBufferedTaskProgressBytesPerInterval = 256 * 1024
	maxBufferedTaskResultBytesPerTask       = 16 * 1024
	maxBufferedTaskResultBytesPerInterval   = 64 * 1024

	taskProgressTruncatedMarker = "\n[ct-ops] output truncated before next heartbeat\n"
	taskResultTruncatedMarker   = "task result truncated before next heartbeat"
)

// Runner manages the bidirectional heartbeat stream with the ingest service.
type Runner struct {
	// dialFunc creates a fresh gRPC connection for each stream attempt. A new
	// connection is used every time rather than reusing a long-lived ClientConn
	// because gRPC's internal TRANSIENT_FAILURE state can get stuck after a
	// server restart — a fresh connection always starts clean.
	dialFunc func() (*grpc.ClientConn, error)
	agentID  string
	jwtToken string
	version  string
	interval time.Duration
	executor *checks.Executor

	// CPU two-sample state
	prevCPUTotal   uint64
	prevCPUIdle    uint64
	prevCPUSampled bool

	// cachedMetrics holds the most recently collected system metrics.
	// It is updated only on regular ticker fires and the initial startup
	// heartbeat. Immediate heartbeats triggered by resultsReady reuse these
	// values so that the CPU delta is always measured over a full tick interval
	// rather than a near-zero window that would inflate the reading to 100%.
	cachedMetrics hostMetricsSnapshot

	// Buffered ad-hoc query results, drained on each heartbeat send.
	queryResultsMu sync.Mutex
	queryResults   []*agentv1.AgentQueryResult

	// Buffered agent task progress chunks and results, drained on each heartbeat send.
	taskProgressMu            sync.Mutex
	taskProgress              []*agentv1.AgentTaskProgress
	taskProgressBytes         int
	taskProgressBytesByTask   map[string]int
	taskProgressTruncatedTask map[string]bool
	taskResultsMu             sync.Mutex
	taskResults               []*agentv1.AgentTaskResult

	// Dedupes server-pushed queries: the ingest handler may re-push the same
	// query on consecutive 2s poll ticks while the agent is still executing it.
	seenMu       sync.Mutex
	seenQueryIDs map[string]struct{}

	// Dedupes server-pushed tasks: prevents double-execution if the server
	// re-sends the same task before the agent has reported a result.
	seenTaskIDs map[string]struct{}

	// taskCancelFuncs maps task_run_host_id → context.CancelFunc for every
	// task currently running on this agent. Used to stop tasks on server request.
	taskCancelFuncs sync.Map

	// Signalled when new query results are ready so the send loop can fire
	// an immediate heartbeat rather than waiting for the next 30s tick.
	resultsReady chan struct{}

	// Signalled when the server pushes a new client cert or when a local
	// renewal check has obtained a new one via RenewCertificate. The stream
	// loop tears down the current stream so the next dial picks up the new
	// cert from disk.
	certRotated chan struct{}

	// dataDir is the agent's on-disk identity directory (passed through from
	// config). Used to persist a newly-issued cert atomically.
	dataDir string

	// keypair is needed to generate a fresh CSR when renewing.
	keypair *identity.Keypair

	// lastKnownDefs is the most recent non-empty set of check definitions
	// received from the server. Used to restore checks after a stream reconnect
	// if the executor has no running goroutines (e.g. after an agent restart).
	lastKnownDefs []*agentv1.CheckDefinition

	// pinnedServerCertMu guards pinnedServerCertPEM and pinnedServerCertFpr.
	// These hold the nginx-facing server cert fingerprint and PEM pushed by
	// ingest so the agent can preserve that trust material on disk while the
	// signed self-update flow is redesigned.
	pinnedServerCertMu  sync.Mutex
	pinnedServerCertPEM []byte
	pinnedServerCertFpr string

	// lastSkippedUpdateVersion suppresses duplicate warnings when the server
	// repeatedly advertises the same release while auto-update is disabled.
	lastSkippedUpdateVersion string
}

// New creates a new heartbeat Runner. dialFunc is called once per stream
// attempt to obtain a fresh gRPC connection; the runner closes it when the
// stream ends. dataDir and keypair enable mTLS cert rotation — when nil/empty
// the runner skips cert-related work (useful for tests and load-test paths).
func New(dialFunc func() (*grpc.ClientConn, error), agentID, jwtToken, version string, intervalSecs int, executor *checks.Executor, dataDir string, keypair *identity.Keypair) *Runner {
	r := &Runner{
		dialFunc:     dialFunc,
		agentID:      agentID,
		jwtToken:     jwtToken,
		version:      version,
		interval:     time.Duration(intervalSecs) * time.Second,
		executor:     executor,
		seenQueryIDs: make(map[string]struct{}),
		seenTaskIDs:  make(map[string]struct{}),
		resultsReady: make(chan struct{}, 1),
		certRotated:  make(chan struct{}, 1),
		dataDir:      dataDir,
		keypair:      keypair,
	}
	// Prime the pinned server cert from disk so the first heartbeat sends the
	// correct fingerprint and preserves any previously pushed trust material.
	if dataDir != "" {
		if pem, fpr, err := identity.LoadPinnedServerCert(dataDir); err == nil {
			r.pinnedServerCertPEM = pem
			r.pinnedServerCertFpr = fpr
		} else {
			slog.Warn("loading pinned server cert", "err", err)
		}
	}
	return r
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

		// Server explicitly rejected this agent — do not retry; propagate so
		// the caller can clear local state and trigger re-registration.
		if isFatalAgentError(err) {
			slog.Warn("server rejected agent — clearing state for re-registration", "err", err)
			return ErrAgentDeregistered
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
	conn, err := r.dialFunc()
	if err != nil {
		return fmt.Errorf("connecting to ingest: %w", err)
	}
	defer conn.Close()

	client := agentv1.NewIngestServiceClient(conn)

	// Proactive renewal: if our leaf is within the renewal window, ask the
	// server for a fresh one over the current (still-valid) mTLS connection
	// before opening the long-lived heartbeat stream. If renewal succeeds we
	// close this conn and let the outer loop redial with the new cert.
	if r.dataDir != "" && r.keypair != nil {
		if rotated, rErr := r.maybeRenewCert(ctx, client); rErr != nil {
			slog.Warn("proactive cert renewal failed, continuing with current cert", "err", rErr)
		} else if rotated {
			return nil // outer loop will redial with new cert
		}
	}

	stream, err := client.Heartbeat(ctx)
	if err != nil {
		return fmt.Errorf("opening heartbeat stream: %w", err)
	}

	// Reset dedup maps per stream session. Anything pushed on a previous
	// (now-dead) stream will be re-pushed by the server on reconnect and must
	// be re-executed; keeping stale IDs would silently drop them.
	r.seenMu.Lock()
	r.seenQueryIDs = make(map[string]struct{})
	r.seenTaskIDs = make(map[string]struct{})
	r.seenMu.Unlock()

	slog.Info("heartbeat stream opened", "agent_id", r.agentID)

	// Background receiver: the server pushes HeartbeatResponses both as
	// replies to our heartbeats and proactively when queries arrive, so we
	// cannot call stream.Recv() inline in sendHeartbeat. Run it in its own
	// goroutine and signal the send loop via recvErr on failure.
	streamCtx, cancelRecv := context.WithCancel(ctx)
	defer cancelRecv()
	recvErr := make(chan error, 1)
	go r.runReceiver(ctx, streamCtx, stream, recvErr)

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	// Collect metrics and send first heartbeat immediately. The first message
	// authenticates the stream, so agent_id carries the JWT for that one send.
	r.refreshMetrics()
	if err := r.sendHeartbeatWithAgentID(stream, r.jwtToken); err != nil {
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
			// Full metric refresh on every scheduled tick.
			r.refreshMetrics()
			if err := r.sendHeartbeat(stream); err != nil {
				return err
			}

		case <-r.resultsReady:
			// A check/task result is ready — fire an immediate heartbeat to
			// deliver it without waiting up to 30s for the next tick.
			// Do NOT refresh metrics here: the CPU delta since the last tick
			// would be near-zero, inflating the reading towards 100%.
			// sendHeartbeat reuses the cached values from the last tick.
			if err := r.sendHeartbeat(stream); err != nil {
				return err
			}

		case <-r.certRotated:
			// Fresh client cert is on disk. Close this stream cleanly so
			// the outer loop redials with the new cert for mTLS.
			slog.Info("client cert rotated — reconnecting stream to pick up new cert")
			_ = stream.CloseSend()
			return nil
		}
	}
}

// runReceiver reads HeartbeatResponses from the stream in a loop and dispatches
// their contents. It exits (and signals recvErr) on any stream error.
// rootCtx is the agent process lifetime context used for spawning check goroutines
// so they survive stream reconnects. streamCtx is the stream-scoped context used
// only to detect intentional stream teardown.
func (r *Runner) runReceiver(
	rootCtx context.Context,
	streamCtx context.Context,
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
			if streamCtx.Err() != nil {
				return
			}
			recvErr <- fmt.Errorf("receiving heartbeat response: %w", err)
			return
		}
		r.handleResponse(rootCtx, resp)
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
		r.lastKnownDefs = resp.Checks
		r.executor.UpdateDefinitions(ctx, resp.Checks)
	} else if !r.executor.HasRunningChecks() && r.lastKnownDefs != nil {
		slog.Info("restoring check definitions from cache", "count", len(r.lastKnownDefs))
		r.executor.UpdateDefinitions(ctx, r.lastKnownDefs)
	}
	if len(resp.PendingQueries) > 0 {
		// Run queries in a goroutine so the receive loop is never blocked by
		// a slow subprocess. Dedupe against in-flight / already-completed IDs.
		fresh := r.filterUnseenQueries(resp.PendingQueries)
		if len(fresh) > 0 {
			go r.executeQueries(fresh)
		}
	}
	if resp.PendingTask != nil {
		r.seenMu.Lock()
		_, dup := r.seenTaskIDs[resp.PendingTask.TaskId]
		if !dup {
			r.seenTaskIDs[resp.PendingTask.TaskId] = struct{}{}
		}
		r.seenMu.Unlock()
		if !dup {
			if resp.PendingTask.TaskType == "software_inventory" {
				go r.executeTask(ctx, resp.PendingTask)
			} else {
				go r.rejectHostAccessTask(resp.PendingTask)
			}
		}
	}
	if len(resp.CancelTaskIds) > 0 {
		for _, id := range resp.CancelTaskIds {
			if fn, ok := r.taskCancelFuncs.Load(id); ok {
				slog.Info("cancelling task on server request", "task_id", id)
				fn.(context.CancelFunc)()
			} else {
				slog.Debug("cancel request for task not in flight (may have already completed)", "task_id", id)
			}
		}
	}
	if resp.PendingServerCertPem != "" {
		r.applyServerCertRotation(resp.PendingServerCertPem)
	}
	if resp.PendingClientCertPem != "" && r.dataDir != "" {
		if err := identity.SaveClientCert(r.dataDir, []byte(resp.PendingClientCertPem)); err != nil {
			slog.Warn("saving pushed client cert", "err", err)
		} else {
			if resp.AgentCaCertPem != "" {
				_ = identity.SaveAgentCA(r.dataDir, []byte(resp.AgentCaCertPem))
			}
			slog.Info("received new client cert from server",
				"not_after_unix", resp.PendingClientCertNotAfterUnix,
			)
			select {
			case r.certRotated <- struct{}{}:
			default: // already signalled
			}
		}
	}
	if resp.UpdateAvailable && resp.DownloadUrl != "" {
		r.noteSkippedSelfUpdate(resp.LatestVersion)
	}
}

func (r *Runner) noteSkippedSelfUpdate(latestVersion string) {
	if latestVersion == "" || latestVersion == r.lastSkippedUpdateVersion {
		return
	}
	r.lastSkippedUpdateVersion = latestVersion
	slog.Warn("agent update available, but automatic self-update is disabled until release signature verification is implemented",
		"current", r.version,
		"latest", latestVersion,
	)
}

// maybeRenewCert checks the on-disk leaf cert's expiry. If it's within the
// renewal window, builds a fresh CSR, calls RenewCertificate, and persists
// the new leaf atomically. Returns (rotated, err). rotated=true means the
// caller should tear down the current conn so the outer dial picks up the
// new cert. Renewal never makes the agent unusable — any error is returned
// without touching the on-disk cert, and the existing cert stays in force.
func (r *Runner) maybeRenewCert(ctx context.Context, client agentv1.IngestServiceClient) (bool, error) {
	_, cert, err := identity.LoadClientCert(r.dataDir)
	if err != nil {
		return false, fmt.Errorf("loading cert for renewal check: %w", err)
	}
	if cert == nil {
		return false, nil // no cert yet — pending registration flow
	}
	if !identity.ShouldRenew(cert, time.Now()) {
		return false, nil
	}
	csrDER, err := r.keypair.BuildCSR()
	if err != nil {
		return false, fmt.Errorf("building renewal CSR: %w", err)
	}
	renewCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := client.RenewCertificate(renewCtx, &agentv1.RenewCertificateRequest{
		AgentId: r.agentID,
		CsrDer:  csrDER,
	})
	if err != nil {
		return false, err
	}
	if resp.ClientCertPem == "" {
		return false, fmt.Errorf("empty cert PEM in RenewCertificate response")
	}
	if err := identity.SaveClientCert(r.dataDir, []byte(resp.ClientCertPem)); err != nil {
		return false, fmt.Errorf("saving renewed cert: %w", err)
	}
	if resp.AgentCaCertPem != "" {
		_ = identity.SaveAgentCA(r.dataDir, []byte(resp.AgentCaCertPem))
	}
	slog.Info("renewed client cert", "not_after_unix", resp.ClientCertNotAfterUnix)
	return true, nil
}

// filterUnseenQueries returns queries not yet seen for this stream's lifetime.
func (r *Runner) filterUnseenQueries(queries []*agentv1.AgentQuery) []*agentv1.AgentQuery {
	r.seenMu.Lock()
	defer r.seenMu.Unlock()
	out := make([]*agentv1.AgentQuery, 0, len(queries))
	for _, q := range queries {
		if _, dup := r.seenQueryIDs[q.QueryId]; dup {
			continue
		}
		r.seenQueryIDs[q.QueryId] = struct{}{}
		out = append(out, q)
	}
	return out
}

// executeQueries runs each query, buffers the result, and nudges the send loop
// to fire an immediate heartbeat with the results.
func (r *Runner) executeQueries(queries []*agentv1.AgentQuery) {
	for _, q := range queries {
		slog.Info("executing agent query", "query_id", q.QueryId, "type", q.QueryType)
		result := checks.RunQuery(q)
		r.queryResultsMu.Lock()
		r.queryResults = append(r.queryResults, result)
		r.queryResultsMu.Unlock()
		slog.Info("agent query completed",
			"query_id", q.QueryId,
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
func (r *Runner) drainQueryResults() []*agentv1.AgentQueryResult {
	r.queryResultsMu.Lock()
	defer r.queryResultsMu.Unlock()
	results := r.queryResults
	r.queryResults = nil
	return results
}

// executeTask runs the task in the background, forwarding incremental output
// chunks via progressFn and buffering the final result for the next heartbeat.
// Each task gets its own derived context so it can be cancelled independently
// via handleResponse without tearing down the whole heartbeat stream.
func (r *Runner) executeTask(ctx context.Context, task *agentv1.AgentTask) {
	taskCtx, taskCancel := context.WithCancel(ctx)
	r.taskCancelFuncs.Store(task.TaskId, taskCancel)
	defer func() {
		taskCancel() // always release the context resources
		r.taskCancelFuncs.Delete(task.TaskId)
	}()

	progressFn := func(chunk string) {
		r.bufferTaskProgress(task.TaskId, chunk)
		// Nudge the send loop so progress is reported promptly.
		select {
		case r.resultsReady <- struct{}{}:
		default:
		}
	}

	result := tasks.Dispatch(taskCtx, task, progressFn)

	r.bufferTaskResult(result)

	select {
	case r.resultsReady <- struct{}{}:
	default:
	}
}

func (r *Runner) rejectHostAccessTask(task *agentv1.AgentTask) {
	r.taskResultsMu.Lock()
	r.taskResults = append(r.taskResults, &agentv1.AgentTaskResult{
		TaskId:   task.TaskId,
		TaskType: task.TaskType,
		ExitCode: -1,
		Error:    "agent-mediated host access is disabled; use SSH-backed host access with a host user password",
	})
	r.taskResultsMu.Unlock()

	select {
	case r.resultsReady <- struct{}{}:
	default:
	}
}

// drainTaskProgress atomically returns and clears all buffered task progress chunks.
func (r *Runner) drainTaskProgress() []*agentv1.AgentTaskProgress {
	r.taskProgressMu.Lock()
	defer r.taskProgressMu.Unlock()
	p := r.taskProgress
	r.taskProgress = nil
	r.taskProgressBytes = 0
	r.taskProgressBytesByTask = make(map[string]int)
	r.taskProgressTruncatedTask = make(map[string]bool)
	return p
}

// drainTaskResults atomically returns and clears all buffered task results.
func (r *Runner) drainTaskResults() []*agentv1.AgentTaskResult {
	r.taskResultsMu.Lock()
	defer r.taskResultsMu.Unlock()
	if len(r.taskResults) == 0 {
		return nil
	}

	used := 0
	n := 0
	for n < len(r.taskResults) {
		size := taskResultSize(r.taskResults[n])
		if n > 0 && used+size > maxBufferedTaskResultBytesPerInterval {
			break
		}
		used += size
		n++
		if used >= maxBufferedTaskResultBytesPerInterval {
			break
		}
	}

	results := append([]*agentv1.AgentTaskResult(nil), r.taskResults[:n]...)
	r.taskResults = append([]*agentv1.AgentTaskResult(nil), r.taskResults[n:]...)
	return results
}

func (r *Runner) bufferTaskProgress(taskID, chunk string) {
	if chunk == "" {
		return
	}

	r.taskProgressMu.Lock()
	defer r.taskProgressMu.Unlock()

	if r.taskProgressBytesByTask == nil {
		r.taskProgressBytesByTask = make(map[string]int)
	}
	if r.taskProgressTruncatedTask == nil {
		r.taskProgressTruncatedTask = make(map[string]bool)
	}
	if r.taskProgressTruncatedTask[taskID] {
		return
	}

	perTaskBudget := maxBufferedTaskProgressBytesPerTask - r.taskProgressBytesByTask[taskID]
	intervalBudget := maxBufferedTaskProgressBytesPerInterval - r.taskProgressBytes
	budget := minInt(perTaskBudget, intervalBudget)
	if budget <= 0 {
		r.appendTaskProgressTruncationLocked(taskID, "")
		return
	}
	if len(chunk) <= budget {
		r.appendTaskProgressLocked(taskID, chunk)
		return
	}

	r.appendTaskProgressTruncationLocked(taskID, chunk[:budget])
}

func (r *Runner) appendTaskProgressLocked(taskID, chunk string) {
	if chunk == "" {
		return
	}
	r.taskProgress = append(r.taskProgress, &agentv1.AgentTaskProgress{
		TaskId:      taskID,
		OutputChunk: chunk,
	})
	r.taskProgressBytes += len(chunk)
	r.taskProgressBytesByTask[taskID] += len(chunk)
}

func (r *Runner) appendTaskProgressTruncationLocked(taskID, prefix string) {
	if r.taskProgressTruncatedTask[taskID] {
		return
	}

	perTaskBudget := maxBufferedTaskProgressBytesPerTask - r.taskProgressBytesByTask[taskID]
	intervalBudget := maxBufferedTaskProgressBytesPerInterval - r.taskProgressBytes
	budget := minInt(perTaskBudget, intervalBudget)
	if budget <= 0 {
		return
	}

	markerBytes := len(taskProgressTruncatedMarker)
	chunk := prefix
	if len(chunk) >= budget {
		if budget > markerBytes {
			chunk = truncateUTF8(chunk, budget-markerBytes)
		} else {
			chunk = ""
		}
	}

	if markerBytes > budget-len(chunk) {
		marker := truncateUTF8(taskProgressTruncatedMarker, budget-len(chunk))
		r.appendTaskProgressLocked(taskID, chunk+marker)
	} else {
		r.appendTaskProgressLocked(taskID, chunk+taskProgressTruncatedMarker)
	}

	r.taskProgressTruncatedTask[taskID] = true
}

func (r *Runner) bufferTaskResult(result *agentv1.AgentTaskResult) {
	if result == nil {
		return
	}

	r.taskResultsMu.Lock()
	defer r.taskResultsMu.Unlock()
	r.taskResults = append(r.taskResults, clampTaskResult(result, maxBufferedTaskResultBytesPerTask))
}

func clampTaskResult(result *agentv1.AgentTaskResult, maxBytes int) *agentv1.AgentTaskResult {
	clamped := *result
	if taskResultSize(&clamped) <= maxBytes {
		return &clamped
	}

	clamped.ResultJson = `{"truncated":true}`
	clamped.Error = clampTaskResultError(clamped.Error, maxBytes-taskResultStaticSize(&clamped)-len(clamped.ResultJson))
	if taskResultSize(&clamped) > maxBytes {
		clamped.ResultJson = ""
		clamped.Error = clampTaskResultError(clamped.Error, maxBytes-taskResultStaticSize(&clamped))
	}
	return &clamped
}

func clampTaskResultError(existing string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if existing == "" {
		return truncateUTF8(taskResultTruncatedMarker, maxBytes)
	}

	suffix := " (" + taskResultTruncatedMarker + ")"
	if maxBytes <= len(suffix) {
		return truncateUTF8(taskResultTruncatedMarker, maxBytes)
	}
	return truncateUTF8(existing, maxBytes-len(suffix)) + suffix
}

func taskResultSize(result *agentv1.AgentTaskResult) int {
	if result == nil {
		return 0
	}
	return taskResultStaticSize(result) + len(result.ResultJson) + len(result.Error)
}

func taskResultStaticSize(result *agentv1.AgentTaskResult) int {
	if result == nil {
		return 0
	}
	return len(result.TaskId) + len(result.TaskType)
}

func truncateUTF8(s string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(s) <= maxBytes {
		return s
	}

	s = s[:maxBytes]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// hostMetricsSnapshot holds a point-in-time snapshot of system metrics.
type hostMetricsSnapshot struct {
	cpu       float32
	memory    float32
	disk      float32
	uptime    int64
	osVersion string
	disks     []*agentv1.DiskInfo
	nets      []*agentv1.NetworkInterface
}

// refreshMetrics collects fresh system metrics and stores them in the cache.
// Call this only on regular ticker fires (and the initial startup heartbeat) so
// that the CPU delta is always measured over a full tick interval. Immediate
// heartbeats triggered by resultsReady must NOT call this — they must reuse the
// cached values to avoid inflating CPU% to ~100% from a near-zero delta window.
func (r *Runner) refreshMetrics() {
	cpu, mem, disk, uptime, osVersion, disks, nets := r.collectMetrics()
	r.cachedMetrics = hostMetricsSnapshot{
		cpu:       cpu,
		memory:    mem,
		disk:      disk,
		uptime:    uptime,
		osVersion: osVersion,
		disks:     disks,
		nets:      nets,
	}
}

func (r *Runner) sendHeartbeat(stream agentv1.IngestService_HeartbeatClient) error {
	return r.sendHeartbeatWithAgentID(stream, r.agentID)
}

func (r *Runner) sendHeartbeatWithAgentID(stream agentv1.IngestService_HeartbeatClient, agentIDField string) error {
	m := r.cachedMetrics
	req := &agentv1.HeartbeatRequest{
		AgentId:                     agentIDField,
		CpuPercent:                  m.cpu,
		MemoryPercent:               m.memory,
		DiskPercent:                 m.disk,
		UptimeSeconds:               m.uptime,
		TimestampUnix:               time.Now().Unix(),
		AgentVersion:                r.version,
		OsVersion:                   m.osVersion,
		Os:                          runtime.GOOS,
		Arch:                        runtime.GOARCH,
		Disks:                       m.disks,
		NetworkInterfaces:           m.nets,
		CheckResults:                r.executor.DrainResults(),
		QueryResults:                r.drainQueryResults(),
		TaskProgress:                r.drainTaskProgress(),
		TaskResults:                 r.drainTaskResults(),
		PinnedServerCertFingerprint: r.currentPinnedFingerprint(),
	}

	if err := stream.Send(req); err != nil {
		return fmt.Errorf("sending heartbeat: %w", err)
	}
	return nil
}

// currentPinnedFingerprint returns the fingerprint of the pinned server cert
// last pushed by ingest. Empty when no cert is pinned yet.
func (r *Runner) currentPinnedFingerprint() string {
	r.pinnedServerCertMu.Lock()
	defer r.pinnedServerCertMu.Unlock()
	return r.pinnedServerCertFpr
}

// applyServerCertRotation persists the pushed PEM to disk and updates the
// in-memory pin so the next heartbeat advertises the new fingerprint and the
// agent preserves the latest trust material on disk.
func (r *Runner) applyServerCertRotation(certPEM string) {
	if certPEM == "" || r.dataDir == "" {
		return
	}
	pemBytes := []byte(certPEM)
	if err := identity.SavePinnedServerCert(r.dataDir, pemBytes); err != nil {
		slog.Warn("persisting rotated server cert", "err", err)
		return
	}
	_, fp, err := identity.LoadPinnedServerCert(r.dataDir)
	if err != nil {
		slog.Warn("reading rotated server cert after save", "err", err)
		return
	}
	r.pinnedServerCertMu.Lock()
	r.pinnedServerCertPEM = pemBytes
	r.pinnedServerCertFpr = fp
	r.pinnedServerCertMu.Unlock()
	slog.Info("rotated pinned server cert", "fingerprint", fp)
}

// collectMetrics gathers all system metrics. Returns best-effort values;
// on unsupported platforms or read errors individual values will be zero/empty.
func (r *Runner) collectMetrics() (cpu, mem, disk float32, uptimeSecs int64, osVersion string, disks []*agentv1.DiskInfo, nets []*agentv1.NetworkInterface) {
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
// This must only be called via refreshMetrics() which is invoked on the regular
// ticker, ensuring the delta always spans a full tick interval.
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
func readNetworkInterfaces() []*agentv1.NetworkInterface {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	var result []*agentv1.NetworkInterface
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

		result = append(result, &agentv1.NetworkInterface{
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

// isFatalAgentError returns true when the error chain contains a gRPC status
// that means the server has permanently rejected this agent identity.
// These errors must not be retried — the agent must re-register instead.
func isFatalAgentError(err error) bool {
	for err != nil {
		if st, ok := status.FromError(err); ok {
			switch st.Code() {
			case codes.NotFound, codes.PermissionDenied, codes.Unauthenticated:
				return true
			}
		}
		err = errors.Unwrap(err)
	}
	return false
}
