// Package checks implements the agent-side check execution engine.
// The Executor manages a set of running check goroutines. Check definitions
// are received from the server via HeartbeatResponse and reconciled on each
// heartbeat. Results are accumulated and drained by the heartbeat runner.
package checks

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	agentv1 "github.com/infrawatch/proto/agent/v1"
)

// Executor manages concurrent check goroutines and accumulates their results.
type Executor struct {
	mu      sync.Mutex
	results []agentv1.CheckResult

	// cancels maps checkID → cancel function for the running goroutine
	cancels map[string]context.CancelFunc
	// defs maps checkID → the definition that goroutine is running
	defs map[string]agentv1.CheckDefinition
}

// NewExecutor creates a new idle Executor.
func NewExecutor() *Executor {
	return &Executor{
		cancels: make(map[string]context.CancelFunc),
		defs:    make(map[string]agentv1.CheckDefinition),
	}
}

// UpdateDefinitions reconciles running goroutines with the incoming set.
// Removed checks are cancelled; new or changed checks are (re)started.
// ctx should be the agent-level context so goroutines survive stream reconnects.
func (e *Executor) UpdateDefinitions(ctx context.Context, incoming []agentv1.CheckDefinition) {
	incomingSet := make(map[string]agentv1.CheckDefinition, len(incoming))
	for _, def := range incoming {
		incomingSet[def.CheckID] = def
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// Cancel goroutines for checks that are no longer present or have changed
	for id, cancel := range e.cancels {
		newDef, exists := incomingSet[id]
		if !exists || definitionChanged(e.defs[id], newDef) {
			cancel()
			delete(e.cancels, id)
			delete(e.defs, id)
		}
	}

	// Start goroutines for new checks
	for id, def := range incomingSet {
		if _, running := e.cancels[id]; running {
			continue
		}
		checkCtx, cancel := context.WithCancel(ctx)
		e.cancels[id] = cancel
		e.defs[id] = def
		go e.runCheck(checkCtx, def)
	}
}

// DrainResults atomically returns and clears all accumulated results.
func (e *Executor) DrainResults() []agentv1.CheckResult {
	e.mu.Lock()
	defer e.mu.Unlock()
	results := e.results
	e.results = nil
	return results
}

func (e *Executor) runCheck(ctx context.Context, def agentv1.CheckDefinition) {
	interval := time.Duration(def.IntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 60 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on start
	e.executeOnce(def)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.executeOnce(def)
		}
	}
}

func (e *Executor) executeOnce(def agentv1.CheckDefinition) {
	start := time.Now()
	checkStatus, output := dispatchCheck(def)
	result := agentv1.CheckResult{
		CheckID:    def.CheckID,
		Status:     checkStatus,
		Output:     output,
		DurationMs: int32(time.Since(start).Milliseconds()),
		RanAtUnix:  start.Unix(),
	}

	e.mu.Lock()
	e.results = append(e.results, result)
	e.mu.Unlock()

	slog.Debug("check executed", "check_id", def.CheckID, "type", def.CheckType, "status", checkStatus)
}

func dispatchCheck(def agentv1.CheckDefinition) (status, output string) {
	switch def.CheckType {
	case "port":
		var cfg PortConfig
		if err := json.Unmarshal([]byte(def.ConfigJSON), &cfg); err != nil {
			return "error", "invalid port config: " + err.Error()
		}
		return runPortCheck(cfg)
	case "process":
		var cfg ProcessConfig
		if err := json.Unmarshal([]byte(def.ConfigJSON), &cfg); err != nil {
			return "error", "invalid process config: " + err.Error()
		}
		return runProcessCheck(cfg)
	case "http":
		var cfg HttpConfig
		if err := json.Unmarshal([]byte(def.ConfigJSON), &cfg); err != nil {
			return "error", "invalid http config: " + err.Error()
		}
		return runHttpCheck(cfg)
	default:
		return "error", "unknown check type: " + def.CheckType
	}
}

// definitionChanged returns true if the two definitions differ in a way that
// warrants restarting the check goroutine.
func definitionChanged(old, new agentv1.CheckDefinition) bool {
	return old.CheckType != new.CheckType ||
		old.ConfigJSON != new.ConfigJSON ||
		old.IntervalSeconds != new.IntervalSeconds
}
