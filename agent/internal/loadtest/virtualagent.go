package loadtest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/carrtech-dev/ct-ops/agent/internal/identity"
	"github.com/carrtech-dev/ct-ops/agent/internal/registration"
	agentv1 "github.com/carrtech-dev/ct-ops/proto/agent/v1"
)

const agentVersion = "loadtest-v1"

// VirtualAgent represents one simulated agent within a load-test run. It owns
// its keypair, JWT, and heartbeat-stream lifecycle.
type VirtualAgent struct {
	index    int
	hostname string
	cfg      *Config
	pool     *ConnPool
	stats    *Stats

	keypair  *identity.Keypair
	agentID  string
	jwtToken string
	metrics  *SyntheticMetrics

	// Result queues populated by server-push handlers, drained on next heartbeat.
	mu              sync.Mutex
	pendingChecks   []*agentv1.CheckResult
	pendingQueries  []*agentv1.AgentQueryResult
	pendingProgress []*agentv1.AgentTaskProgress
	pendingResults  []*agentv1.AgentTaskResult

	// Dedupe maps so the same server-pushed work is not processed twice after
	// a stream reconnect (matches the real agent's seenQueryIDs/seenTaskIDs
	// pattern).
	seenChecks    map[string]bool
	seenQueries   map[string]bool
	seenTasks     map[string]bool
	seenTerminals map[string]bool

	rng *rand.Rand
}

// NewVirtualAgent constructs an un-registered virtual agent for the given
// slot index. Call Register to do the first contact, then Run to start the
// heartbeat loop.
func NewVirtualAgent(index int, cfg *Config, pool *ConnPool, stats *Stats) (*VirtualAgent, error) {
	kp, err := GenerateInMemoryKeypair()
	if err != nil {
		return nil, err
	}
	hostname := cfg.HostnameFor(index)
	return &VirtualAgent{
		index:         index,
		hostname:      hostname,
		cfg:           cfg,
		pool:          pool,
		stats:         stats,
		keypair:       kp,
		metrics:       NewSyntheticMetrics(index, hostname, cfg.MetricsJitter),
		seenChecks:    make(map[string]bool),
		seenQueries:   make(map[string]bool),
		seenTasks:     make(map[string]bool),
		seenTerminals: make(map[string]bool),
		rng:           rand.New(rand.NewSource(int64(index) + time.Now().UnixNano())),
	}, nil
}

// Register performs the RegisterRequest RPC and stores the resulting JWT.
// Returns the response status so the caller can surface "pending" to the
// operator (typically an enrolment-token misconfiguration).
func (v *VirtualAgent) Register(ctx context.Context) (status string, err error) {
	conn, err := v.pool.Get(v.index)
	if err != nil {
		return "", fmt.Errorf("acquiring conn: %w", err)
	}
	client := agentv1.NewIngestServiceClient(conn)

	// Load-test agents share a single data dir on the driver host, but cert
	// rotation doesn't matter here — they won't persist certs. Pass empty
	// dataDir so SaveClientCert no-ops on an empty PEM.
	reg := registration.New(client, v.keypair, v.cfg.OrgToken, agentVersion, nil, "")
	reg.SetHostnameOverride(v.hostname)
	// Empty IP list — critical for the load tester so the server's hostname/IP
	// collision check does not adopt an existing host onto this virtual agent's
	// keypair. See CLAUDE planning notes for full justification.
	reg.SetIPAddressesOverride([]string{})

	// Short deadline on the Register call itself — the registrar polls
	// internally if status is pending, but we only surface the first response.
	regCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	state, err := reg.Register(regCtx, "")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return "pending", fmt.Errorf("register timed out (token likely lacks auto_approve=true)")
		}
		return "", fmt.Errorf("register RPC: %w", err)
	}

	v.agentID = state.AgentID
	v.jwtToken = state.JWTToken
	return "active", nil
}

// Run drives the heartbeat loop until the context is cancelled. On stream
// error it reconnects with exponential backoff.
func (v *VirtualAgent) Run(ctx context.Context) {
	backoff := time.Second
	const maxBackoff = 60 * time.Second

	for {
		if ctx.Err() != nil {
			return
		}

		err := v.runStream(ctx)
		if err == nil || errors.Is(err, context.Canceled) {
			return
		}
		v.stats.RecordError(truncate(err.Error(), 200))

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
		v.stats.Reconnects.Add(1)
	}
}

func (v *VirtualAgent) runStream(ctx context.Context) error {
	conn, err := v.pool.Get(v.index)
	if err != nil {
		return fmt.Errorf("acquiring conn: %w", err)
	}
	client := agentv1.NewIngestServiceClient(conn)

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	stream, err := client.Heartbeat(streamCtx)
	if err != nil {
		return fmt.Errorf("opening heartbeat: %w", err)
	}

	v.stats.StreamsOpen.Add(1)
	defer v.stats.StreamsOpen.Add(-1)

	// First heartbeat carries the JWT as the agent_id field (matches the
	// server's JWT-in-first-message auth behaviour).
	firstSentAt := time.Now()
	if err := v.sendHeartbeat(stream, v.jwtToken); err != nil {
		return fmt.Errorf("first heartbeat: %w", err)
	}

	// Drain the first response inline so we can record RTT and bootstrap any
	// pending state. Failures here usually mean the JWT was rejected.
	resp, err := stream.Recv()
	if err != nil {
		return fmt.Errorf("first recv: %w", err)
	}
	v.stats.RecordRTT(time.Since(firstSentAt))
	v.handleServerPush(streamCtx, client, resp)

	// From here the server responses stream back out-of-band; a goroutine
	// drains them and forwards server-pushed work to the dispatch handler.
	recvErrCh := make(chan error, 1)
	go func() {
		for {
			msg, err := stream.Recv()
			if err != nil {
				recvErrCh <- err
				return
			}
			v.handleServerPush(streamCtx, client, msg)
		}
	}()

	// Jitter the first tick by up to ±10% of the interval so N agents don't
	// fire at the same millisecond on a shared clock.
	jitter := time.Duration(v.rng.Float64()*0.2*float64(v.cfg.HeartbeatInterval)) - (v.cfg.HeartbeatInterval / 10)
	initialDelay := v.cfg.HeartbeatInterval + jitter

	tick := time.NewTimer(initialDelay)
	defer tick.Stop()

	for {
		select {
		case <-streamCtx.Done():
			return streamCtx.Err()
		case err := <-recvErrCh:
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("recv: %w", err)
		case <-tick.C:
			if err := v.sendHeartbeat(stream, v.agentID); err != nil {
				v.stats.HeartbeatsFailed.Add(1)
				return fmt.Errorf("heartbeat send: %w", err)
			}
			tick.Reset(v.cfg.HeartbeatInterval)
		}
	}
}

// sendHeartbeat marshals a single HeartbeatRequest carrying current synthetic
// metrics plus any pending results accumulated since the last heartbeat.
func (v *VirtualAgent) sendHeartbeat(stream agentv1.IngestService_HeartbeatClient, agentIDField string) error {
	snap := v.metrics.Tick()

	v.mu.Lock()
	checks := v.pendingChecks
	queries := v.pendingQueries
	progress := v.pendingProgress
	results := v.pendingResults
	v.pendingChecks = nil
	v.pendingQueries = nil
	v.pendingProgress = nil
	v.pendingResults = nil
	v.mu.Unlock()

	req := &agentv1.HeartbeatRequest{
		AgentId:           agentIDField,
		CpuPercent:        snap.CPUPercent,
		MemoryPercent:     snap.MemoryPercent,
		DiskPercent:       snap.DiskPercent,
		UptimeSeconds:     snap.UptimeSeconds,
		TimestampUnix:     time.Now().Unix(),
		AgentVersion:      agentVersion,
		OsVersion:         snap.OSVersion,
		Os:                "linux",
		Arch:              "amd64",
		Disks:             snap.Disks,
		NetworkInterfaces: snap.NetIfaces,
		CheckResults:      checks,
		QueryResults:      queries,
		TaskProgress:      progress,
		TaskResults:       results,
	}

	started := time.Now()
	if err := stream.Send(req); err != nil {
		return err
	}
	v.stats.RecordSendLatency(time.Since(started))
	v.stats.HeartbeatsSent.Add(1)
	v.stats.BytesSent.Add(int64(proto.Size(req)))
	v.stats.ChecksReported.Add(int64(len(checks)))
	v.stats.QueriesAnswered.Add(int64(len(queries)))
	if len(results) > 0 {
		v.stats.TasksCompleted.Add(int64(len(results)))
	}
	return nil
}

// handleServerPush dispatches each of the push-type fields on a
// HeartbeatResponse to its simulation handler.
func (v *VirtualAgent) handleServerPush(ctx context.Context, client agentv1.IngestServiceClient, resp *agentv1.HeartbeatResponse) {
	if resp == nil {
		return
	}

	if v.cfg.SimulateChecks {
		for _, c := range resp.Checks {
			if c == nil || v.seenChecks[c.CheckId] {
				continue
			}
			v.seenChecks[c.CheckId] = true
			v.queueCheckResult(c)
		}
	}

	for _, q := range resp.PendingQueries {
		if q == nil || v.seenQueries[q.QueryId] {
			continue
		}
		v.seenQueries[q.QueryId] = true
		v.queueQueryResult(q)
	}

	if v.cfg.SimulateTasks && resp.PendingTask != nil {
		t := resp.PendingTask
		if !v.seenTasks[t.TaskId] {
			v.seenTasks[t.TaskId] = true
			go v.simulateTask(ctx, client, t)
		}
	}

	if v.cfg.SimulateTerminal {
		for _, tsr := range resp.PendingTerminalSessions {
			if tsr == nil || v.seenTerminals[tsr.SessionId] {
				continue
			}
			v.seenTerminals[tsr.SessionId] = true
			go v.simulateTerminalSession(ctx, client, tsr)
		}
	}
}

func (v *VirtualAgent) queueCheckResult(def *agentv1.CheckDefinition) {
	status := "pass"
	if v.rng.Float64() < v.cfg.CheckFailureRate {
		status = "fail"
	}
	res := &agentv1.CheckResult{
		CheckId:    def.CheckId,
		Status:     status,
		Output:     fmt.Sprintf("loadtest synthetic result for check_type=%s", def.CheckType),
		DurationMs: int32(10 + v.rng.Intn(200)),
		RanAtUnix:  time.Now().Unix(),
	}
	v.mu.Lock()
	v.pendingChecks = append(v.pendingChecks, res)
	v.mu.Unlock()
}

func (v *VirtualAgent) queueQueryResult(q *agentv1.AgentQuery) {
	res := &agentv1.AgentQueryResult{
		QueryId:   q.QueryId,
		QueryType: q.QueryType,
		Status:    "ok",
	}
	switch q.QueryType {
	case "list_ports":
		res.Ports = []*agentv1.PortInfo{
			{Port: 22, Protocol: "tcp", Process: "sshd"},
			{Port: 80, Protocol: "tcp", Process: "nginx"},
			{Port: 443, Protocol: "tcp", Process: "nginx"},
		}
	case "list_services":
		res.Services = []*agentv1.ServiceInfo{
			{Name: "sshd.service", LoadState: "loaded", ActiveSub: "running"},
			{Name: "cron.service", LoadState: "loaded", ActiveSub: "running"},
		}
	}
	v.mu.Lock()
	v.pendingQueries = append(v.pendingQueries, res)
	v.mu.Unlock()
}

// truncate clips a string to max bytes. Used to keep error samples small so
// the distinct-error map doesn't blow up on verbose gRPC errors.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

