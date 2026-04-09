# Bug Tracker: Agent Checks Stop Sending Results

**Status:** Open — no confirmed fix yet  
**First observed:** ~2026-04-09  
**Symptoms:** Agents stop sending check results after a random period (minutes to hours). Metrics and heartbeats continue normally. No agent crash or visible reconnect.

---

## Symptoms

- Check UI shows "X hours ago" for all checks on a host
- Metrics charts show continuous, consistent data (CPU/memory/disk)
- Heartbeat interval chart shows regular ~30s intervals
- All 6 checks were last seen at the same timestamp — suggests a single event stopped everything at once, not individual check failures
- After stopping, checks never self-recover without manual intervention (agent restart)

---

## Architecture: How Checks Flow

```
Agent (Go binary)
  └── checks/executor.go  — goroutines per check; accumulate results
  └── heartbeat/heartbeat.go — sends results to ingest on each tick

        ↓ gRPC bidirectional stream (HeartbeatRequest/HeartbeatResponse)

Ingest service (Go)
  └── handlers/heartbeat.go:Heartbeat()
       1. Auth + resolve hostID (ONCE at stream start)
       2. Loop: processHeartbeat() per received message
            - Metrics saved (no hostID needed)
            - Checks saved (only if hostID != "")
            - Check definitions pushed back to agent (only if hostID != "")
```

**Critical asymmetry:** Metrics bypass the `hostID` check. Checks require a valid `hostID`. This explains why metrics continue while checks stop.

---

## Root Cause: Most Likely Hypothesis

**Stream reconnect + `hostID` resolution failure on reconnect**

**File:** `apps/ingest/internal/handlers/heartbeat.go:97–102`

```go
// Resolve host ID once for the lifetime of this stream
hostID, err := queries.GetHostByAgentID(ctx, h.pool, agentID)
if err != nil {
    slog.Warn("resolving host for agent", "agent_id", agentID, "err", err)
    hostID = ""  // ← silently empty for entire stream lifetime
}
```

`hostID` is resolved **once** at stream start, never retried. If the database query fails for any reason (pool exhaustion, timeout, brief outage, race at startup), `hostID` stays `""` for the entire stream lifetime.

**Cascade from `hostID == ""`:**

1. `processHeartbeat()` line 234: `if hostID != ""` → **SKIPPED**
   - Check results received from agent are **discarded silently**
   - Alert evaluation is **skipped**
2. `processHeartbeat()` line 329: `if hostID != ""` → **SKIPPED**
   - Check definitions are **not pushed** to agent in the response

**Agent side** (`agent/internal/heartbeat/heartbeat.go:202–204`):
```go
if len(resp.Checks) > 0 {
    r.executor.UpdateDefinitions(ctx, resp.Checks)
}
```

When the response has no check definitions (because ingest skipped them), the agent does NOT call `UpdateDefinitions`. On a fresh stream (after reconnect), existing check goroutines from the old stream were already cancelled (their context was cancelled when the stream closed). Since no new definitions arrive, **no new check goroutines are started**.

**Result:** Agent looks healthy (metrics, heartbeats fine), but all check goroutines are dead and the ingest service silently discards any results that do arrive.

---

## Why Metrics Keep Working

In `processHeartbeat()`, metrics are saved unconditionally:

```go
// Lines 205–231: no hostID check
queries.UpdateAgentHeartbeat(...)    // uses agentID only
queries.UpdateHostVitals(...)        // uses agentID only
queries.InsertHostMetricByAgentID(...)  // uses orgID + agentID
```

All three metric operations use `agentID` or `orgID`, neither of which requires the hosts table lookup.

---

## Secondary Contributing Factors

### Check goroutines are stream-scoped

In `agent/internal/heartbeat/heartbeat.go`:
```go
streamCtx, cancelRecv := context.WithCancel(ctx)
defer cancelRecv()  // ← cancels ALL check goroutines when stream ends
go r.runReceiver(streamCtx, stream, recvErr)
```

`streamCtx` is passed to `UpdateDefinitions`, which spawns check goroutines. When the stream closes (for any reason), `cancelRecv()` is deferred and kills all check goroutines. On the new stream, checks only restart if `resp.Checks` is non-empty on the first response.

### JWT is not actually validated

In `apps/ingest/internal/handlers/heartbeat.go:63–72`:
```go
agentID, _, err := h.issuer.ValidateAgentToken(first.AgentId)
if err != nil {
    agentID = first.AgentId  // ← falls back to raw agent ID
    slog.Debug("JWT validation failed, using agent_id directly", ...)
}
```

The agent sends its plain agent ID in the `AgentId` field (not a JWT token). `ValidateAgentToken` always fails; the fallback always fires. JWT expiry is **not** a cause of reconnects. This is a security issue to fix separately but does not cause the checks bug.

---

## Key File Locations

| File | Lines | Notes |
|---|---|---|
| `apps/ingest/internal/handlers/heartbeat.go` | 97–102 | `hostID` resolved once — **root of the bug** |
| `apps/ingest/internal/handlers/heartbeat.go` | 234, 329 | Check operations guarded by `hostID != ""` |
| `apps/ingest/internal/handlers/heartbeat.go` | 204–231 | Metrics — no `hostID` check, always saved |
| `agent/internal/heartbeat/heartbeat.go` | 132–133 | `streamCtx` scoped to stream; kills goroutines on disconnect |
| `agent/internal/heartbeat/heartbeat.go` | 202–204 | Only calls `UpdateDefinitions` if response has checks |
| `agent/internal/checks/executor.go` | 48–56 | Cancels goroutines for removed/changed checks |
| `apps/ingest/internal/db/queries/hosts.sql.go` | ~26–32 | `GetHostByAgentID` — single DB call that can fail silently |

---

## Proposed Fix (Not Yet Implemented)

**Change:** Retry `hostID` resolution on each heartbeat instead of only at stream start.

In `apps/ingest/internal/handlers/heartbeat.go`, the `hostID` variable is currently a local captured in the stream closure. The fix is to re-attempt resolution if it failed:

**Option A — Retry in the main loop before calling `processHeartbeat`:**
```go
// In the for-loop body, before calling processHeartbeat:
if hostID == "" {
    if resolved, err := queries.GetHostByAgentID(ctx, h.pool, agentID); err == nil {
        slog.Info("host ID resolved after retry", "agent_id", agentID, "host_id", resolved)
        hostID = resolved
    }
}
```

This self-heals within one heartbeat interval (~30s) after the DB recovers, without requiring a stream reconnect.

**Option B — Move `hostID` resolution into `processHeartbeat`:**
Pass `*string` instead of `string` so the function can update it. More invasive.

**Additional hardening (regardless of which option):**
- Log at `Error` (not just `Warn`) when `hostID == ""` and check results are being discarded — silent discard is the worst part
- Add a metric/counter for "heartbeats with missing hostID" so this is observable

---

## Fix Attempt History

| Date | Change | Outcome |
|---|---|---|
| 2026-04-09 | **Fix attempt 1** — three changes applied (see below) | Deployed, awaiting observation |

### Fix attempt 1 detail (2026-04-09)

Three targeted changes, no schema/SQL/proto changes:

**1. Ingest: retry `hostID` resolution on every heartbeat when empty**
`apps/ingest/internal/handlers/heartbeat.go` — In the main event loop, before calling `processHeartbeat` and inside the `queryPollTicker` case, added a retry block: if `hostID == ""`, call `GetHostByAgentID` again. Self-heals within ~30s of DB recovering. Logs `"resolved host after retry"` at Info when it succeeds.

**2. Agent: check goroutines now use the agent root context**
`agent/internal/heartbeat/heartbeat.go` — Changed `runReceiver` to accept both `rootCtx` (agent process lifetime) and `streamCtx` (stream-scoped). `streamCtx` used only for stream teardown detection; `rootCtx` passed to `handleResponse` → `UpdateDefinitions`. Check goroutines now survive stream reconnects — they keep running and accumulate results until the next successful heartbeat.

**3. Agent: cache last-known check definitions**
`agent/internal/heartbeat/heartbeat.go` + `agent/internal/checks/executor.go` — Added `lastKnownDefs` field to Runner. When definitions arrive, they're cached. If no goroutines are running and no definitions arrive on reconnect, the cache is restored automatically. Added `HasRunningChecks()` to Executor to guard the restore condition. Logs `"restoring check definitions from cache"` at Info when it fires.

---

## How to Diagnose When It Happens Again

1. **Check ingest logs** for: `"resolving host for agent"` — if this appears, `hostID` resolution failed at stream start
2. **Check ingest logs** for: `"fetching checks for host"` — if this appears frequently, the per-heartbeat query is failing
3. **Check agent logs** for: `"heartbeat stream ended, reconnecting"` — indicates a stream reconnect occurred (which resets check goroutines)
4. SSH into agent: `carrtech-adm@10.10.8.210` and check agent logs:
   ```bash
   sudo journalctl -u infrawatch-agent -n 200 --no-pager
   ```
5. Look for the timestamp when checks last appeared in the UI — compare against stream reconnect events in agent/ingest logs

---

## Notes

- The question "is this JWT vs mTLS related?" — **No.** JWT is not actually being validated in the current heartbeat flow. The agent sends its plain agent ID. JWT expiry is not a factor.
- mTLS is described in the architecture docs but not yet implemented in the heartbeat path.
- This bug could also surface as "checks never start" for a newly enrolled agent if the hosts table row isn't committed before the first heartbeat arrives (race condition at enrolment).
