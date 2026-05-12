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
| Define Docker telemetry protobuf contract | Codex | review | `proto/agent/v1/*.proto`, generated Go protobufs | None | Messages represent Docker status, container inventory, metric samples, batch ids, dropped sample counts, and payload limits. Existing agents remain compatible. | [#1338](https://github.com/carrtech-dev/ct-ops/pull/1338) | Added heartbeat Docker status/config and dedicated Docker telemetry upload RPC; validation passed locally. |
| Define database schema contract | unclaimed | pending | `apps/web/lib/db/schema/*`, migrations | Protobuf contract | Schema covers Docker container inventory and time-series metrics with tenant/host scoping and query indexes. | TBD | Avoid storing only current values. |
| Define settings and retention contract | unclaimed | pending | instance settings, host metadata/settings, docs | Database schema contract | Global default is 30 days; host override is nullable; effective retention behavior is documented. | TBD | Per-host retention probably needs a sweeper, not only Timescale table retention. |
| Define UI information architecture | unclaimed | pending | host detail UI, Administration settings | Schema/settings contract | Host Docker status, Containers tab, settings locations, and empty states are documented. | TBD | UI should distinguish not installed from permission denied. |

## Phase 1: Docker Presence And UI Status

Purpose: prove the agent-to-ingest-to-UI path before adding high-volume telemetry.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add agent Docker capability detection | unclaimed | pending | `agent/internal/...`, agent tests | Phase 0 protobuf contract | Agent reports Docker status without shelling out where possible and sends no container metrics when Docker is unavailable. | TBD | Statuses: `not_installed`, `installed`, `permission_denied`, `unreachable`, `error`. |
| Persist Docker capability status | unclaimed | pending | `apps/ingest/internal/...`, DB queries, tests | Agent status contract | Ingest validates and stores Docker status by host without breaking old agents. | TBD | Include last checked timestamp and optional error message with bounded length. |
| Display Docker status in host UI | unclaimed | pending | `apps/web/app/(dashboard)/hosts/...`, components, tests | Persisted status | Host detail shows clear Docker status and empty states. | TBD | Avoid implying Docker is installed when status is unknown. |

## Phase 2: Container Inventory

Purpose: list containers per host and track their lifecycle before storing high-frequency metrics.

| Task | Owner | Status | Files / Areas | Dependencies | Acceptance Criteria | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Collect container inventory in agent | unclaimed | pending | agent Docker collector package, tests | Phase 1 agent detection | Agent reports container id, names, image, labels, state, created/started timestamps, and restart count where available. | TBD | Bound label payload size. |
| Upsert container inventory in ingest | unclaimed | pending | ingest handlers, DB queries, schema | Inventory protobuf and schema | Inventory is upserted by `host_id + docker_container_id`; missing containers are marked not currently seen rather than immediately deleted. | TBD | Preserve historical identity for charts after container exits. |
| Add Containers tab/list UI | unclaimed | pending | host detail page/components/actions | Inventory persistence | Users can see current and recently seen containers, image, state, last seen, and restart count. | TBD | Include filters for state, image, and name if feasible in this phase. |

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

- Should Docker telemetry use a dedicated client-streaming RPC or extend heartbeat initially?
- Should Docker retention reuse the existing global metric retention field or use a separate Docker-specific field?
- Should the first release use only in-memory buffering, or include a disk-backed spool for outage tolerance?
- What are the supported Docker-compatible runtimes for the first release: Docker Engine only, or Docker plus containerd/Podman later?
- What default maximum local buffer size should agents use for large hosts with hundreds of containers?
