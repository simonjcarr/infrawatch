# Monitoring

Infrawatch collects system metrics from every agent and lets you define health checks that run on a schedule. Metrics are stored in TimescaleDB and visualised as time-series charts.

---

## Metrics Collection

The agent sends the following vitals with every heartbeat:

| Metric | Unit | Description |
|---|---|---|
| `cpu_percent` | % | CPU utilisation across all cores |
| `memory_percent` | % | RAM utilisation |
| `disk_percent` | % | Root filesystem utilisation |
| `uptime_seconds` | seconds | Host uptime since last boot |

Future versions will add per-disk, per-NIC, and per-process metrics.

---

## Metric Charts

Charts are available on the **Metrics** tab of each host detail page. Each chart is interactive:

- **Time range** — 1 hour, 6 hours, 24 hours, 7 days, 30 days
- **Zoom** — click and drag on any chart to zoom into a specific window
- **Smart bucketing** — data is automatically aggregated to the appropriate resolution based on the selected time range, using TimescaleDB continuous aggregates

---

## Health Checks

Health checks run on the agent and report a pass/fail result back to the ingest service. Results are stored and can trigger alert rules.

### Check types

| Type | What it checks |
|---|---|
| `port` | TCP/UDP connectivity to a host:port |
| `process` | Whether a named process is running |
| `http` | HTTP endpoint reachability and optional status code check |

### Configuring checks

Checks are configured per-host from the **Checks** tab of the host detail page:

1. Click **Add Check**
2. Select the check type
3. Fill in the parameters (target address, port, expected status code, etc.)
4. Set the check interval
5. Click **Save**

The check is pushed to the agent on the next heartbeat and starts running immediately.

---

## TimescaleDB Storage

Raw metrics are written to a TimescaleDB hypertable partitioned by time. Three continuous aggregates are pre-configured:

| Aggregate | Bucket size | Retention |
|---|---|---|
| `metrics_1m` | 1 minute | 7 days |
| `metrics_1h` | 1 hour | 90 days |
| `metrics_1d` | 1 day | 2 years |

The appropriate aggregate is selected automatically based on the chart's time range.

---

## Alerting on Metrics

You can create alert rules that fire when a metric crosses a threshold — for example, CPU > 90% for 5 minutes. See [Alerts](./alerts) for details.
