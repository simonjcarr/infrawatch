# Load Testing

`infrawatch-loadtest` is an operator tool that simulates **N virtual agents** against a running Infrawatch server so you can measure the sustainable fleet capacity of a given hardware profile before recommending sizing to customers.

Virtual agents exercise the real wire protocol (gRPC `Register` + `Heartbeat` + `Terminal` + `SubmitSoftwareInventory`), so the numbers reflect the production code path — ingest, queue, consumers, and database — not a bypass.

---

## When to use it

- Capacity-planning a single-box or HA install on a new VM profile.
- Reproducing a reported scaling issue under controlled conditions.
- Validating that a server-side change hasn't regressed throughput.

**Not** intended as a smoke test for local development — the full agent binary is easier for that.

---

## Building

The load tester is a dev/ops tool; it is **not shipped as a release artefact**. Build it locally from the repo root:

```bash
make loadtest
# produces: dist/infrawatch-loadtest (host platform)
```

---

## Prerequisites on the target server

1. An enrolment token with `auto_approve=true` (virtual agents cannot wait for manual approval).
2. The server is reachable from the load-tester VM on the ingest gRPC port (default `9443`).
3. If the server uses a self-signed certificate, either pass `--ca-cert <path>` or `--tls-skip-verify` (dev only).
4. For `cleanup` to work, set `INFRAWATCH_LOADTEST_ADMIN_KEY` on the **web** server and pass the same key with `--admin-key` below.

Running the tool on a **separate VM** from the server under test is strongly recommended — otherwise your measurements include the load-generator's own CPU/network overhead.

---

## Running a test

```bash
dist/infrawatch-loadtest run \
  --address ingest.example.com:9443 \
  --token <enrolment-token-with-auto-approve> \
  --agents 1000 \
  --ramp 30s \
  --duration 10m \
  --heartbeat-interval 30s \
  --tls-skip-verify \
  --stats-interval 10s
```

The tool prints a live counter every `--stats-interval` and a final summary (including latency percentiles) on shutdown. Ctrl-C ends the run early and still prints the summary.

### Common flags

| Flag | Default | Purpose |
|---|---|---|
| `--address` | *(required)* | Ingest `host:port`. |
| `--token` | *(required)* | Enrolment token — must have `auto_approve=true`. |
| `--agents` | `100` | Total virtual agents. |
| `--ramp` | `30s` | Duration over which registrations are spread. |
| `--duration` | `5m` | Test length. `0` = run until Ctrl-C. |
| `--heartbeat-interval` | `30s` | Per-agent heartbeat cadence. |
| `--ca-cert` | *(unset)* | Path to server CA cert. |
| `--tls-skip-verify` | `false` | Skip TLS verification (dev only). |
| `--conn-fanout` | `50` | Virtual agents sharing a single gRPC connection. |
| `--registration-concurrency` | `32` | Parallel `Register` RPCs during ramp-up. |
| `--run-id` | *(auto)* | Identifier baked into each virtual hostname. |
| `--hostname-prefix` | `loadtest` | Hostname prefix for virtual agents. |
| `--simulate-tasks` | `true` | Respond to server-pushed tasks with fake progress + exit-0. |
| `--simulate-checks` | `true` | Return fake `CheckResult`s for pushed checks. |
| `--simulate-terminal` | `true` | Open short-lived Terminal streams for pushed sessions. |
| `--simulate-inventory` | `true` | Upload fake software inventory on `software_inventory_scan` tasks. |
| `--check-failure-rate` | `0.05` | Fraction of simulated check results reporting `fail`. |
| `--metrics-jitter` | `0.1` | Amplitude of per-tick metric drift (0–1). |
| `--output-json` | *(unset)* | Write final summary as JSON (useful for CI). |

Run `infrawatch-loadtest run --help` for the full list.

---

## What the tool simulates

Every virtual agent:

1. Generates an **in-memory Ed25519 keypair** (nothing persists to disk on the load-tester VM).
2. Calls `Register` with a unique hostname (`loadtest-<run-id>-<nnnn>`) and an **empty IP list** — this is intentional; it sidesteps the server's IP-collision check so N agents don't all adopt the same DB row.
3. Opens a long-lived `Heartbeat` bidi stream, sending a synthetic-metrics heartbeat every `--heartbeat-interval` (±10% jitter).
4. Responds to server pushes:
   - `CheckDefinition` → returns a synthetic `CheckResult` on the next heartbeat.
   - `AgentTask` → emits 2–4 fake progress chunks over a few seconds, then a success result.
   - `AgentQuery` (`list_ports`, `list_services`) → returns canned results.
   - `TerminalSessionRequest` → opens a Terminal stream, sends one banner, closes cleanly.
   - `software_inventory_scan` task → streams 2 chunks of 500 fake packages via `SubmitSoftwareInventory`.
5. Reconnects with exponential backoff (1s → 60s) on stream error.

A **preflight check** runs one throw-away `Register` at startup to verify the token has `auto_approve=true`. If it doesn't, the tool aborts loudly instead of leaving you staring at 1000 agents stuck in `pending`.

---

## Reading the output

Live lines look like:

```
[ 30s] regs: 1000 active / 0 pend / 0 fail | streams: 1000 | hb: 1024 sent (0 failed) | rtt p95: 18ms | recent errors: 0
```

The final summary adds full latency percentiles (p50/p90/p95/p99/p99.9) plus a capped distinct-errors list.

Comparing these numbers to the server's own resource graphs (CPU / memory / disk IO / DB connection count) is what tells you whether a given hardware profile can sustain a given fleet size. Typical failure modes to watch for:

- **Rising p95 heartbeat RTT** → ingest is CPU-bound or DB-bound.
- **Heartbeats failed climbing** → ingest is evicting connections or the DB is refusing.
- **Reconnects rising** → server is dropping streams (check ingest logs).
- **Task completions lagging** → consumer / queue backlog.

---

## Cleanup

Virtual hosts are real rows in `hosts` and related tables; leaving them around will skew dashboards and eventually fill the metrics hypertable. Always clean up after each run.

### One-shot cleanup (recommended)

The load tester ships with a `cleanup` subcommand that calls a narrow admin endpoint on the web app. Because the endpoint wraps the same `deleteHost()` action used everywhere else in the product, any foreign-key added in future is handled automatically.

1. On the web server, set `INFRAWATCH_LOADTEST_ADMIN_KEY` to a secret of your choice.
2. From the load-tester VM:

   ```bash
   dist/infrawatch-loadtest cleanup \
     --web-url https://infrawatch.example.com \
     --admin-key <key> \
     --run-id <id-printed-at-end-of-run>
   ```

The command prints the number of hosts deleted and any failures.

### Fallback: manual UI cleanup

If the admin endpoint is not configured (e.g. the env var is unset — the endpoint returns `503` in that case), the run's end-of-test output also prints a hostname filter you can paste into the hosts-list search box (`loadtest-<run-id>-*`) and delete in bulk via the UI.

### Fallback: raw SQL (dev only)

The cleanup hint also prints a `DELETE FROM hosts WHERE hostname LIKE 'loadtest-<run-id>-%'` snippet. **This is not safe for production** — it bypasses the FK cascade — but is occasionally useful against throw-away dev databases. Prefer the `cleanup` subcommand.

---

## Out of scope (v1)

- Agent self-update simulation — `update_available` responses are ignored.
- Adaptive ramp — the tool does not auto-slow if server errors spike. Watch the live stats and abort with Ctrl-C if the server is struggling.
- mTLS client certificates — the server uses server-only TLS today.
- Published release artefacts — host-local build only via `make loadtest`.
