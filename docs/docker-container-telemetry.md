# Docker Container Telemetry

CT-Ops can collect Docker Engine runtime status, container inventory, and
container metric samples from enrolled hosts. The agent samples container
metrics locally and uploads them in batches so short spikes are preserved
without sending one request every few seconds per host.

## What Is Stored

Docker telemetry is split into three database areas:

- `host_docker_status` stores the latest Docker runtime status for a host.
- `docker_containers` stores container inventory and lifecycle state by host.
- `docker_container_metrics` stores raw time-series samples for CPU, memory,
  network, block I/O, pids, and restart count.

The ingest service also stores recent `docker_telemetry_batches` rows for retry
idempotency. These rows prevent duplicate inserts when an agent retries a batch.

## Retention Defaults

Docker container metrics are kept for 30 days by default. This is separate from
normal host metric retention because container telemetry can have a much higher
sample volume and supports per-host overrides.

Administrators can change the global Docker metric retention period in:

```text
Administration > Monitoring > Metric retention > Docker metric retention period
```

Allowed values are whole days from 1 through 365. New instances use 30 days
unless an administrator changes the setting.

## Host Overrides

Each host can override the global Docker retention period in:

```text
Host detail > Settings > Docker Retention
```

The host setting is nullable:

- `inherit` uses the global Docker retention period.
- A numeric value keeps that host's Docker metrics for that many days.
- Clearing the override returns the host to the global value.

Effective retention is calculated as:

```text
host override ?? global Docker retention ?? 30
```

Host overrides are useful when a few high-churn Docker hosts need shorter
retention than the rest of the fleet, or when a critical host needs a longer
window for investigation.

## Cleanup Timing

The ingest service runs the Docker telemetry retention sweeper at startup and
then every 24 hours while ingest is running. The sweeper deletes
`docker_container_metrics` rows older than each host's effective retention
window.

The sweeper is the source of truth for Docker metric cleanup. A broad TimescaleDB
retention policy may be used as an upper bound in the future, but it cannot
replace the sweeper because TimescaleDB policies cannot express per-host Docker
retention overrides.

Docker telemetry idempotency batch records are shorter lived than metric data.
The sweeper deletes `docker_telemetry_batches` rows after 7 days.

Because cleanup runs periodically, lowering retention does not remove old Docker
metric rows immediately. The change takes effect on the next sweeper run, or on
the next ingest restart when the startup sweep runs.

## Storage Sizing

Docker metric volume scales with:

- number of Docker hosts,
- number of containers per host,
- agent sample interval,
- amount of container network and block I/O activity,
- retention days.

The default agent sample interval is 2 seconds. At that interval, one always-on
container can produce up to 43,200 raw metric samples per day before batching and
database overhead. A host with 50 continuously running containers can therefore
produce up to 2.16 million raw samples per day.

Use shorter retention for high-churn or dense container hosts unless the
investigation window requires long raw history. For large fleets, start with the
30-day default only if database capacity has been sized for the expected
container count, then reduce high-volume host overrides where needed.

## Operational Notes

- Docker status and container inventory are not purged by Docker metric
  retention. Missing containers are marked not present instead of being
  immediately deleted.
- Docker runtime status can be `unknown`, `installed`, `not_installed`,
  `permission_denied`, `unreachable`, or `error`.
- The UI should not expose raw Docker socket paths or internal agent errors.
  Operators should use the bounded diagnostic text shown on the host page.
- Agents with Docker unavailable do not upload container metrics.
