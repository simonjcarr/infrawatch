# Docker Container Telemetry Implementation Plan

This document is the shared coordination file for implementing Docker container telemetry in CT-Ops. Agents working on this feature should read this file before starting, claim tasks here, and update status as work progresses.

## Goals

- Detect whether Docker is available on each monitored host.
- Show Docker availability clearly in the CT-Ops UI, including not installed and permission-denied states.
- Collect telemetry for each Docker container at a high enough local frequency to catch short spikes.
- Batch telemetry in the agent so CT-Ops does not receive a request every few seconds per host.
- Store 30 days of Docker telemetry by default.
- Allow a global retention setting in Administration.
- Allow each host to override Docker telemetry retention days.
- Give infrastructure engineers container-level visibility without needing to SSH to individual VMs.

## Recommended Architecture

- The agent samples Docker locally every 2 seconds by default.
- The agent buffers container samples locally and flushes batches on the normal telemetry/heartbeat cadence.
- Docker status is reported separately from container telemetry so the UI can show `not_installed`, `installed`, `permission_denied`, `unreachable`, or `error`.
- Container identity/inventory and container metric samples are stored separately.
- The UI should expose raw recent data and rollups that preserve short spikes using max/p95, not only averages.
- Retention is calculated as `host override ?? global default ?? 30`.

## Coordination Rules

- Claim a task before editing related files by changing `Owner` and `Status`.
- Do not edit files owned by another in-progress task without recording coordination notes here first.
- Contract changes to protobuf messages, schema shape, or retention semantics must land before dependent tasks start.
- Keep phase boundaries intact unless tasks have clearly disjoint file ownership.
- Update `Status`, `PR`, and `Notes` before handing work off.
- Use Conventional Commit titles and PR titles.
- Follow `AGENTS.md` for worktree, test, PR, merge, release, and cleanup requirements.

## Status Values

- `pending`: not started.
- `in_progress`: claimed and actively being worked.
- `blocked`: cannot continue until the blocker in `Notes` is resolved.
- `review`: implementation is in PR or awaiting validation.
- `done`: merged to `main` and any required release/publish work is complete.

## Phase 0: Contract And Design

Purpose: define the cross-component contract before parallel implementation starts.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Define Docker telemetry protobuf contract | Codex | done | `proto/agent/v1/*.proto`, generated Go protobufs | None | Messages represent Docker status, container inventory, metric samples, batch ids, dropped sample counts, and payload limits. Existing agents remain compatible. | [#1338](https://github.com/carrtech-dev/ct-ops/pull/1338) | Merged in #1338. Added heartbeat Docker status/config and dedicated Docker telemetry upload RPC. |
| Define database schema contract | Codex | done | `apps/web/lib/db/schema/*`, migrations | Protobuf contract | Schema covers Docker container inventory and time-series metrics with tenant/host scoping and query indexes. | TBD | Contract documented below in `Database Schema Contract`. Avoid storing only current values. |
| Define settings and retention contract | Codex | done | instance settings, host metadata/settings, docs | Database schema contract | Global default is 30 days; host override is nullable; effective retention behavior is documented. | TBD | Contract documented below in `Settings And Retention Contract`. Per-host retention uses a sweeper. |
| Define UI information architecture | Codex | done | host detail UI, Administration settings | Schema/settings contract | Host Docker status, Containers tab, settings locations, and empty states are documented. | TBD | Contract documented below in `UI Information Architecture`. UI distinguishes not installed from permission denied. |

## Resolved Phase 0 Decisions

- Docker telemetry uses the dedicated `SubmitDockerTelemetry` client-streaming RPC added in [#1338](https://github.com/carrtech-dev/ct-ops/pull/1338). Heartbeat keeps only lightweight Docker capability/config fields.
- Server-controlled agent limits are delivered in `HeartbeatResponse.docker_telemetry_config`. Agent-side defaults remain 2-second sampling and bounded in-memory buffering unless the server overrides them.
- The first release targets Docker Engine compatibility only. Podman/containerd support can be added later behind separate contract work once the Docker path is stable.
- The first release uses an in-memory bounded buffer. Disk spooling is explicitly deferred unless field evidence shows restart resilience is required.
- Docker retention uses a Docker-specific global setting instead of reusing host metric retention. Container telemetry volume and per-host override semantics differ enough that it should not share the existing `metricRetentionDays` field.

## Database Schema Contract

### Host runtime status

- Add a dedicated `host_docker_status` table instead of storing runtime status only in `hosts.metadata`.
- Columns:
  `id`, `instance_id`, `host_id`, `status`, `checked_at`, `runtime_version`, `api_version`, `error_message`, `created_at`, `updated_at`.
- Constraints and indexes:
  unique on `host_id`; index on `(instance_id, status, checked_at desc)`.
- Notes:
  `error_message` must be bounded before persistence. Old agents can continue to leave this table empty, which the UI treats as `unknown`.

### Container inventory

- Add a `docker_containers` table keyed by host-scoped Docker identity.
- Columns:
  `id`, `instance_id`, `host_id`, `docker_container_id`, `primary_name`, `names_json`, `image`, `image_id`, `labels_json`, `state`, `status`, `created_at_source`, `started_at_source`, `finished_at_source`, `first_seen_at`, `last_seen_at`, `last_inventory_at`, `restart_count`, `is_present`, `created_at`, `updated_at`.
- Constraints and indexes:
  unique on `(host_id, docker_container_id)`; indexes on `(instance_id, host_id, is_present, last_seen_at desc)` and `(instance_id, image)`.
- Notes:
  `primary_name` is the first normalized name used for table display and search. `names_json` and `labels_json` keep the full bounded payload. Missing containers are marked `is_present = false`; rows are not hard-deleted on disappearance.

### Metric samples

- Add a `docker_container_metrics` hypertable for raw samples.
- Columns:
  `id`, `instance_id`, `host_id`, `docker_container_row_id`, `docker_container_id`, `recorded_at`, `cpu_percent`, `memory_usage_bytes`, `memory_limit_bytes`, `memory_percent`, `network_rx_bytes`, `network_tx_bytes`, `block_read_bytes`, `block_write_bytes`, `pids_current`, `restart_count`, `created_at`.
- Constraints and indexes:
  primary key `(id, recorded_at)` to match the current time-series pattern; indexes on `(instance_id, host_id, recorded_at desc)` and `(instance_id, docker_container_row_id, recorded_at desc)`.
- Notes:
  Store both `docker_container_row_id` and `docker_container_id` so historical samples remain queryable even if inventory rows are later migrated or rehydrated.

### Batch idempotency

- Add a small `docker_telemetry_batches` table for retry safety.
- Columns:
  `instance_id`, `host_id`, `agent_id`, `batch_id`, `sequence`, `received_at`, `sample_count`, `inventory_count`.
- Constraints and indexes:
  unique on `(host_id, batch_id)`; index on `received_at`.
- Notes:
  Ingest should ack duplicate batches without re-inserting metrics. This table can be purged on a short retention window such as 7 days.

## Settings And Retention Contract

- Add `dockerMetricRetentionDays integer not null default 30` to `instance_settings`.
- Add `dockerTelemetrySettings` under `InstanceMetadata` for server-controlled defaults sent to agents:
  `enabled`, `sampleIntervalSeconds`, `maxBatchBytes`, `maxSamplesPerBatch`, `maxInventoryItemsPerBatch`, `maxLabelBytesPerContainer`.
- Add `dockerSettings` under `HostMetadata` with:
  `retentionDaysOverride?: number | null`.
- Effective retention remains:
  `host override ?? global docker default ?? 30`.
- Validation bounds:
  global and host Docker retention values must be whole days in the range `1..365`. `null` clears the host override.
- Admin UI writes the global value. Host settings writes only the nullable override.
- The retention sweeper is the source of truth for correctness:
  it deletes `docker_container_metrics` rows by host-effective retention and may also age out long-stale `docker_telemetry_batches`.
- A coarse Timescale policy may still be applied to `docker_container_metrics`, but only as an upper bound. It must never be the only retention mechanism because it cannot express per-host overrides.

## UI Information Architecture

### Host detail

- Add a Docker runtime status card in the host overview area of [`apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx`](/Volumes/MacBookStorage-Dev/dev/carrtech/ct-ops-docker-project/apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx).
- Status presentation rules:
  `unknown` for old agents or not-yet-seen data; `installed`; `not_installed`; `permission_denied`; `unreachable`; `error`.
- Display `last checked` and a short bounded diagnostic when available. Do not expose raw socket paths or internal stack traces.

### Host tabs

- Add a top-level `Containers` tab on the host detail page after the current inventory-oriented tabs.
- Phase 2 list view columns:
  name, image, state, status text, last seen, started at, restart count.
- Empty states:
  separate copy for Docker not installed, permission denied, unavailable/error, and installed-but-no-containers.
- Phase 3 extends the same tab with per-container charts rather than creating a second Docker-specific top-level area.

### Settings locations

- Administration:
  extend [`apps/web/app/(dashboard)/settings/monitoring/retention/page.tsx`](/Volumes/MacBookStorage-Dev/dev/carrtech/ct-ops-docker-project/apps/web/app/(dashboard)/settings/monitoring/retention/page.tsx) and the shared settings client to show a distinct Docker retention control next to existing host metric retention.
- Host settings:
  extend [`apps/web/app/(dashboard)/hosts/[id]/settings-tab.tsx`](/Volumes/MacBookStorage-Dev/dev/carrtech/ct-ops-docker-project/apps/web/app/(dashboard)/hosts/[id]/settings-tab.tsx) with a Docker retention override card that shows inherited/default/effective state and allows clearing the override.

### Query and filtering expectations

- Host detail queries must authorize by `instance_id` and `host_id`.
- Container list filtering in Phase 2 should support state, image, and text search over normalized name plus image.
- Fleet-wide container search remains Phase 5 work and should build on the same normalized fields rather than ad hoc JSON search.

## Phase 1: Docker Presence And UI Status

Purpose: prove the agent-to-ingest-to-UI path before adding high-volume telemetry.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add agent Docker capability detection | Codex | done | `agent/internal/...`, agent tests | Phase 0 protobuf contract | Agent reports Docker status without shelling out where possible and sends no container metrics when Docker is unavailable. | [#1342](https://github.com/carrtech-dev/ct-ops/pull/1342) | Merged in #1342. Reports Docker socket status on heartbeat via `/version`; statuses: `not_installed`, `installed`, `permission_denied`, `unreachable`, `error`. |
| Persist Docker capability status | Codex | done | `apps/ingest/internal/...`, DB queries, tests | Agent status contract | Ingest validates and stores Docker status by host without breaking old agents. | [#1345](https://github.com/carrtech-dev/ct-ops/pull/1345) | Merged in #1345. Stores last checked timestamp and bounded optional error message. |
| Display Docker status in host UI | Codex | done | `apps/web/app/(dashboard)/hosts/...`, components, tests | Persisted status | Host detail shows clear Docker status and empty states. | [#1347](https://github.com/carrtech-dev/ct-ops/pull/1347) | Merged in #1347. Host overview now shows Docker runtime status with unknown, installed, not installed, permission denied, unreachable, and error states. |

## Phase 2: Container Inventory

Purpose: list containers per host and track their lifecycle before storing high-frequency metrics.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Collect container inventory in agent | Codex | done | agent Docker collector package, tests | Phase 1 agent detection | Agent reports container id, names, image, labels, state, created/started timestamps, and restart count where available. | [#1350](https://github.com/carrtech-dev/ct-ops/pull/1350) | Merged in #1350. Agent now collects Docker Engine API inventory with bounded labels. Upload remains dependent on ingest inventory upsert work. |
| Upsert container inventory in ingest | Codex | done | ingest handlers, DB queries, schema | Inventory protobuf and schema | Inventory is upserted by `host_id + docker_container_id`; missing containers are marked not currently seen rather than immediately deleted. | [#1353](https://github.com/carrtech-dev/ct-ops/pull/1353) | Merged in #1353. Added Docker inventory schema, ingest stream handling, field bounds, and missing-container marking. |
| Add Containers tab/list UI | Codex | done | host detail page/components/actions | Inventory persistence | Users can see current and recently seen containers, image, state, last seen, and restart count. | [#1356](https://github.com/carrtech-dev/ct-ops/pull/1356) | Merged in #1356 and released in #1357. Adds the host Containers tab, scoped list action, state/image/name filters, and unavailable-state empty copy. |

## Phase 3: Batched Container Metrics

Purpose: capture short spikes locally while keeping CT-Ops ingest traffic manageable.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Implement agent sampler and buffer | unclaimed | pending | agent Docker sampler/buffer, tests | Phase 2 inventory | Agent samples every 2 seconds by default, stores bounded buffered samples, and records dropped sample counts when full. | TBD | Consider in-memory first; add disk spool only if needed for restart resilience. |
| Implement batched telemetry upload | unclaimed | pending | protobuf RPC/heartbeat integration, agent sender, ingest handler | Sampler/buffer | Agent flushes batches on normal interval; ingest enforces max payload size, timestamp bounds, and idempotency. | TBD | Include batch id or sequence for safe retries. |
| Store container metric samples | unclaimed | pending | `docker_container_metrics` schema, ingest DB queries, tests | Batched upload | Metrics are stored with instance, host, container, recorded_at, CPU, memory, network, block I/O, pids, and restart count. | TBD | Add composite indexes for time-range queries. |
| Add per-container metric charts | unclaimed | pending | web actions, chart components, e2e/component tests | Stored metrics | UI shows CPU, memory, network, block I/O, and pids over time with avg and max where bucketed. | TBD | Max line/area is required to preserve spike visibility. |

## Phase 4: Retention

Purpose: support 30-day default retention with global and per-host controls.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add global Docker retention setting | unclaimed | pending | Administration/settings UI and actions | Phase 0 settings contract | Admin can configure Docker metric retention days; default is 30. | TBD | Decide whether to reuse `metricRetentionDays` or add `containerMetricRetentionDays`. |
| Add host retention override | unclaimed | pending | host settings UI/actions/schema | Global setting | Host settings can set or clear a local Docker retention override. | TBD | Display effective value and inherited/default state. |
| Implement retention sweeper | unclaimed | pending | ingest sweeper or web maintenance job, tests | Global and host settings | Rows are deleted according to each host's effective retention. | TBD | Timescale table retention alone cannot express per-host overrides. |
| Document retention behavior | unclaimed | pending | docs site, feature docs | Retention implementation | Docs explain defaults, overrides, storage impact, and cleanup timing. | TBD | Include sizing caveats for large fleets. |

## Phase 5: Infrastructure Engineer Workflows

Purpose: make the feature operationally useful beyond basic charts.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add top containers views | unclaimed | pending | web actions/components | Phase 3 metrics | Users can rank containers by CPU, memory, network, and block I/O over a selected time range. | TBD | Use max and p95 as ranking options. |
| Add container lifecycle timeline | unclaimed | pending | agent/inventory ingest/UI | Phase 2 inventory | Users can see starts, stops, restarts, and disappeared containers over time. | TBD | Could begin with inferred events from inventory changes. |
| Add alert rules for containers | unclaimed | pending | alert schema/evaluator/UI | Phase 3 metrics | Alerts cover restart loop, memory near limit, sustained CPU, container missing, and high network I/O. | TBD | Avoid alerting on short one-sample noise by default. |
| Add fleet/container search | unclaimed | pending | web routes/actions/components | Phase 2 inventory | Users can search across hosts by container name, image, label, and state. | TBD | Useful for finding where a workload is running. |

## Testing Requirements

- Agent Docker detection tests should cover not installed, permission denied, Docker API error, and installed states.
- Agent sampler tests should cover CPU/memory calculations, bounded buffering, dropped sample counts, and flush behavior.
- Ingest tests should cover old agents, malformed payloads, excessive payloads, idempotent retries, and tenant/host scoping.
- Retention tests should cover global default, host override, clearing override, and mixed-host deletion behavior.
- UI tests should cover Docker status empty states, container list rendering, chart rendering, and settings updates.

## Security And Abuse Resistance

- Treat all agent telemetry as untrusted input.
- Enforce payload size limits and per-agent rate limits in ingest.
- Bound label, container name, image, and error message lengths.
- Validate timestamps to reject very old or far-future samples.
- Authorize all UI reads and writes by instance/host scope.
- Do not expose Docker socket paths, host filesystem details, or raw internal errors in the UI.
- Ensure retention overrides cannot be set to unreasonable values.

## Open Decisions

- What default maximum local buffer size should agents use for large hosts with hundreds of containers?
