package loadtest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"
)

// Runner orchestrates a full load-test run: preflight token check, ramp-up
// registrations, steady-state heartbeats, final summary.
type Runner struct {
	cfg    *Config
	stats  *Stats
	pool   *ConnPool
	output io.Writer
}

// NewRunner constructs a Runner. The caller owns the ConnPool's lifecycle
// after Run returns, though Run will call Close on it on exit.
func NewRunner(cfg *Config, output io.Writer) *Runner {
	pool := NewConnPool(cfg.Address, cfg.CACertFile, cfg.TLSSkipVerify, ceilDiv(cfg.Agents, cfg.ConnFanout))
	return &Runner{
		cfg:    cfg,
		stats:  NewStats(),
		pool:   pool,
		output: output,
	}
}

// Run executes the full load-test. It blocks until the test duration elapses
// or ctx is cancelled (e.g. Ctrl-C), then prints the final summary.
func (r *Runner) Run(ctx context.Context) error {
	defer r.pool.Close()

	fmt.Fprintf(r.output, "Run ID: %s\n", r.cfg.RunID)
	fmt.Fprintf(r.output, "Target: %s | Agents: %d | Heartbeat: %s | Ramp: %s | Duration: %s\n",
		r.cfg.Address, r.cfg.Agents, r.cfg.HeartbeatInterval, r.cfg.Ramp, durOrInfinite(r.cfg.Duration))
	fmt.Fprintf(r.output, "Conn pool size: %d (fanout %d agents/conn)\n", r.pool.Size(), r.cfg.ConnFanout)

	if err := r.preflight(ctx); err != nil {
		return err
	}

	agents := make([]*VirtualAgent, 0, r.cfg.Agents)
	for i := 0; i < r.cfg.Agents; i++ {
		va, err := NewVirtualAgent(i, r.cfg, r.pool, r.stats)
		if err != nil {
			return fmt.Errorf("creating virtual agent %d: %w", i, err)
		}
		agents = append(agents, va)
	}

	// Statistics ticker.
	statsTicker := time.NewTicker(r.cfg.StatsInterval)
	defer statsTicker.Stop()
	statsDone := make(chan struct{})
	go func() {
		defer close(statsDone)
		for {
			select {
			case <-ctx.Done():
				return
			case <-statsTicker.C:
				r.stats.PrintInterval(r.output, r.cfg.Agents)
			}
		}
	}()

	// Ramp-up schedule: spread registrations across r.cfg.Ramp so we don't
	// thundering-herd the ingest DB on the first second.
	rampCtx, rampCancel := context.WithCancel(ctx)
	defer rampCancel()

	var runWG sync.WaitGroup
	sem := make(chan struct{}, r.cfg.RegistrationConc)

	interval := time.Duration(0)
	if r.cfg.Agents > 1 && r.cfg.Ramp > 0 {
		interval = r.cfg.Ramp / time.Duration(r.cfg.Agents)
	}

	startAt := time.Now()
	for i, va := range agents {
		targetDelay := time.Duration(i) * interval
		if wait := time.Until(startAt.Add(targetDelay)); wait > 0 {
			select {
			case <-rampCtx.Done():
				break
			case <-time.After(wait):
			}
		}
		if rampCtx.Err() != nil {
			break
		}

		select {
		case sem <- struct{}{}:
		case <-rampCtx.Done():
			break
		}

		runWG.Add(1)
		r.stats.RegistrationsStarted.Add(1)
		go func(a *VirtualAgent) {
			defer runWG.Done()
			defer func() { <-sem }()

			status, err := a.Register(rampCtx)
			if err != nil {
				r.stats.RegistrationsFailed.Add(1)
				r.stats.RecordError(truncate("register: "+err.Error(), 200))
				return
			}
			switch status {
			case "active":
				r.stats.RegistrationsActive.Add(1)
			case "pending":
				r.stats.RegistrationsPending.Add(1)
				r.stats.RecordError("register returned pending (token lacks auto_approve)")
				return
			default:
				r.stats.RegistrationsFailed.Add(1)
				return
			}
			a.Run(rampCtx)
		}(va)
	}

	// Optional fixed-duration test window. Duration=0 means run until ctx
	// cancellation (Ctrl-C).
	if r.cfg.Duration > 0 {
		select {
		case <-ctx.Done():
		case <-time.After(r.cfg.Duration):
		}
		rampCancel()
	} else {
		<-ctx.Done()
		rampCancel()
	}

	// Wait briefly for agent goroutines to drain so final counters reflect the
	// most recent successful heartbeats.
	drained := make(chan struct{})
	go func() {
		runWG.Wait()
		close(drained)
	}()
	select {
	case <-drained:
	case <-time.After(10 * time.Second):
	}

	<-statsDone
	r.stats.Finalise(r.output, r.cfg.RunID, r.cfg.Agents, r.cfg.OutputJSON)
	r.printCleanupHint()

	return nil
}

// preflight does one throw-away Register call with a fresh keypair to verify
// the enrolment token has auto_approve=true before the real ramp-up begins.
// If the token is misconfigured, aborting here saves the operator from an
// opaque hang where every virtual agent sits in "pending".
func (r *Runner) preflight(ctx context.Context) error {
	fmt.Fprintln(r.output, "Preflight: verifying enrolment token has auto_approve=true...")

	probe, err := NewVirtualAgent(-1, &Config{
		Address:           r.cfg.Address,
		OrgToken:          r.cfg.OrgToken,
		CACertFile:        r.cfg.CACertFile,
		TLSSkipVerify:     r.cfg.TLSSkipVerify,
		HostnamePrefix:    r.cfg.HostnamePrefix,
		RunID:             r.cfg.RunID,
		HeartbeatInterval: r.cfg.HeartbeatInterval,
		MetricsJitter:     r.cfg.MetricsJitter,
	}, r.pool, r.stats)
	if err != nil {
		return fmt.Errorf("preflight setup: %w", err)
	}
	probe.hostname = fmt.Sprintf("%s-%s-preflight", r.cfg.HostnamePrefix, r.cfg.RunID)

	pfCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	status, err := probe.Register(pfCtx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("preflight registration timed out — enrolment token likely lacks auto_approve=true")
		}
		return fmt.Errorf("preflight register: %w", err)
	}
	if status != "active" {
		return fmt.Errorf("preflight registration returned status=%q (need auto_approve=true on enrolment token)", status)
	}
	fmt.Fprintln(r.output, "Preflight OK.")
	return nil
}

func (r *Runner) printCleanupHint() {
	prefix := fmt.Sprintf("%s-%s-", r.cfg.HostnamePrefix, r.cfg.RunID)
	fmt.Fprintln(r.output, "")
	fmt.Fprintln(r.output, "Cleanup — these virtual hosts remain registered on the server:")
	fmt.Fprintf(r.output, "  Hostname filter:  %s*\n", prefix)
	fmt.Fprintf(r.output, "  Bulk-delete CLI:  infrawatch-loadtest cleanup --web-url <url> --admin-key <key> --run-id %s\n", r.cfg.RunID)
	fmt.Fprintf(r.output, "  Dev-only SQL:     DELETE FROM hosts WHERE hostname LIKE '%s%%';\n", prefix)
}

func ceilDiv(a, b int) int {
	if b == 0 {
		return 1
	}
	return (a + b - 1) / b
}

func durOrInfinite(d time.Duration) string {
	if d == 0 {
		return "until Ctrl-C"
	}
	return d.String()
}
