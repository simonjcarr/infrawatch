# PROGRESS.md — Infrawatch Build State
> This file is updated at the END of every Claude Code session.
> It is the source of truth for what exists, what works, and what comes next.
> Read this at the START of every session before doing anything.

---

## Current Phase
**Phase 2 — Monitoring & Alerting**

## Current Status
🟡 Phase 2 nearly complete — Alert history now has paginated browsing (25 per page) with date range and severity filters. TimescaleDB hypertable was retroactively fixed (composite PK on `id + recorded_at`); continuous aggregates (`host_metrics_hourly`, `host_metrics_daily`) created with auto-refresh policies — metric queries for 24h/7d ranges now fall back automatically from aggregates to raw data if needed. Metric retention is configurable per-org in settings (7–365 days). Alert silencing, SMTP + webhook notifications, global alert defaults all remain in place.

---

## What Has Been Built

### Session 15 — Alert history pagination + TimescaleDB continuous aggregates

**Alert history: pagination + date/severity filters** (`apps/web/lib/actions/alerts.ts`, `apps/web/app/(dashboard)/alerts/alerts-client.tsx`, `apps/web/app/(dashboard)/alerts/page.tsx`)
- `getAlertInstances` now accepts `offset`, `dateFrom`, `dateTo`, `severity` filters in addition to the existing `status`/`hostId`/`limit` params
- `getAlertInstanceCount` added — returns the total count matching the same filters (used for pagination metadata)
- Recent History section replaced with a fully paginated Alert History table (25 rows/page)
- Filter controls: severity dropdown + date-from / date-to inputs in the card header; "Clear" button appears when any filter is active; page resets to 0 when any filter changes
- Page count and "X–Y of Z alerts" summary shown in the card description; Previous/Next buttons shown only when there is more than one page
- Table dims with `opacity-60` transition while fetching (TanStack Query `placeholderData: prev`)
- Server no longer pre-fetches `initialRecent` — history is entirely client-driven so SSR doesn't block on a potentially large query

**TimescaleDB hypertable fix** (migration `0012_massive_dormammu.sql`)
- Root cause: migration 0005 called `create_hypertable` but the table had a single-column PK on `id`; TimescaleDB requires the partition column (`recorded_at`) to be part of any unique constraint — so the call silently failed via the EXCEPTION handler
- Fix: changed `host_metrics` schema to composite PK `(id, recorded_at)` in `apps/web/lib/db/schema/metrics.ts`; migration 0012 drops the old `host_metrics_pkey` and adds `host_metrics_id_recorded_at_pk (id, recorded_at)`, then calls `create_hypertable` with `migrate_data => true`
- Migration is fully idempotent (uses `IF EXISTS` / `IF NOT EXISTS` guards in a DO block) so it applies cleanly even if partially applied previously

**TimescaleDB continuous aggregates** (migrations `0011_overrated_mongu.sql`, `0012_massive_dormammu.sql`)
- `host_metrics_hourly` — 1-hour bucket CAGG, refresh policy: every hour, covering last 3 hours
- `host_metrics_daily` — 1-day bucket CAGG, refresh policy: every day, covering last 3 days
- `getHostMetrics` (in `apps/web/lib/actions/agents.ts`) now queries from `host_metrics_hourly` for 24h range and `host_metrics_daily` for 7d range using raw SQL via `db.execute(sql\`...\`)`; falls back to the raw `host_metrics` table if the view doesn't exist (graceful degradation for plain PostgreSQL)

**Metric retention setting** (`apps/web/lib/db/schema/organisations.ts`, `apps/web/lib/actions/settings.ts`, `apps/web/app/(dashboard)/settings/settings-client.tsx`)
- New `metricRetentionDays` integer column (default 30) on `organisations` table — migration `0011_overrated_mongu.sql`
- `updateMetricRetention(orgId, days)` server action validates 1–3650 days; admin-only
- New "Metric Retention" card in Settings UI with a Select (7 / 14 / 30 / 60 / 90 / 180 days / 1 year); Save button disabled when value matches current DB value

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- 13 migrations applied, all with monotonically increasing `when` timestamps ✅
- `host_metrics` hypertable confirmed ✅
- `host_metrics_hourly` + `host_metrics_daily` continuous aggregates confirmed ✅

---

### Session 14 — Agent self-update reliability + native multi-arch CI

**Heartbeat backoff reset after stable stream** (`agent/internal/heartbeat/heartbeat.go`)
- The reconnect backoff now resets to 1 s when a stream ran stably for at least 10 s (`minStableTime`)
- Prevents a transient blip (e.g. firewall state expiry) from locking the agent into a slow 60 s retry cycle on the next failure

**Agent self-update: live version refresh in ingest** (`apps/ingest/internal/config/version_poller.go`, `apps/ingest/internal/handlers/heartbeat.go`, `apps/ingest/cmd/ingest/main.go`)
- Root cause: ingest read `latestVersion` from `.release-please-manifest.json` once at startup and cached it for the process lifetime. The UI's "available version" display uses the `/api/agent/latest` endpoint which queries GitHub live, so UI and ingest diverged whenever a new release was cut without an ingest restart — producing step-wise upgrades (v0.9.0 → v0.11.0 on first restart, v0.11.0 → v0.11.1 on a second).
- Added `VersionPoller` struct: seeds from the startup config value, then re-reads the manifest from disk every 5 minutes in a background goroutine using `atomic.Value` for lock-free reads
- `HeartbeatHandler` replaced `latestVersion string` field with `*config.VersionPoller`; calls `versionPoller.Get()` on each heartbeat so agents are notified of new releases within 5 minutes of the manifest being updated — no service restart required
- Version changes logged at Info level ("agent latest version updated") for observability

**Docker multi-arch builds: native runners instead of QEMU** (`.github/workflows/docker-publish.yml`)
- Root cause: both web and ingest jobs used a single `ubuntu-latest` runner with QEMU emulating arm64; `pnpm install` under QEMU was taking 60+ minutes.
- Replaced with a platform matrix — `ubuntu-latest` (linux/amd64) and `ubuntu-24.04-arm` (linux/arm64) — running in parallel as native builds; arm64 build time drops to ~2–3 minutes
- Each platform job builds and pushes by digest (`push-by-digest=true`), uploads the digest as an artifact; a downstream `merge-web` / `merge-ingest` job downloads both digests and runs `docker buildx imagetools create` to produce the final multi-arch manifest list
- GHA cache scoped per platform (`scope=web-amd64`, `scope=web-arm64`) to prevent cross-arch cache collisions
- No more QEMU step required in any job

**Build state**
- `go build ./apps/ingest/...` — compiles ✅
- `go build ./agent/...` — compiles ✅

---

### Session 13 — Alert silencing + migration runner root-cause fix

**Alert silencing feature** (`apps/web/lib/db/schema/alerts.ts`, `apps/web/lib/actions/alerts.ts`, `apps/web/app/(dashboard)/alerts/alerts-client.tsx`, `apps/web/app/(dashboard)/hosts/[id]/alerts-tab.tsx`, `apps/ingest/internal/db/queries/alerts.sql.go`, `apps/ingest/internal/handlers/alerts.go`)
- New `alert_silences` table — host-scoped or org-wide time windows that suppress alert evaluation; migration `0010_eager_chameleon.sql` generated via `db:generate`
- Server actions: `getSilences`, `getActiveSilencesForHost`, `createSilence`, `deleteSilence`
- Go ingest: `IsHostSilenced` query short-circuits `evaluateAlerts` so silenced hosts skip rule evaluation entirely
- UI: dedicated Silences card on `/alerts` page with Active/Upcoming/Expired badges + add dialog; per-host "Silence Host" button and amber active-silence banner with one-click remove on the host detail Alerts tab

**Migration runner root-cause fix** (`apps/web/lib/db/migrations/meta/_journal.json`, `apps/web/lib/db/migrations/0009_global_alert_defaults.sql`, `apps/web/Dockerfile`, `start.sh`)
- Recurring "migrations not applied" symptom traced to `_journal.json`: drizzle-orm's migrator decides pending migrations by comparing each entry's `when` timestamp against `MAX(created_at)` in `__drizzle_migrations`. Migration 0008 had been hand-crafted with `when: 1775900000000` (artificially in the future), so 0009 and 0010 — with smaller `when` values — were silently classified as already applied and skipped with no error.
- Fix: bumped 0009 → `1775900000001` and 0010 → `1775900000002` so timestamps are strictly monotonic
- 0009 SQL rewritten with `IF NOT EXISTS` guards because its column had been applied to live DBs without being tracked
- Dockerfile: migration SQL files now copied directly from build context (`COPY --chown=nextjs:nodejs apps/web/lib/db/migrations …`) so the layer is always invalidated when migrations change, regardless of builder-stage cache hits
- `start.sh`: explicit `DOCKER_DB_URL` constant and fail-fast on `pnpm db:migrate` failure so silent skips can never happen again
- **Going forward:** never hand-craft migration files or `_journal.json` entries — always `pnpm run db:generate` so `when` is `Date.now()` and remains monotonic

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./apps/ingest/...` — compiles ✅
- `alert_silences` table verified present; `__drizzle_migrations` has all 11 rows

### Session 12 — Notification channel test, edit, and SMTP dispatch fix

**Test notification button** (`apps/web/app/(dashboard)/alerts/alerts-client.tsx`, `apps/web/lib/actions/alerts.ts`)
- Flask icon button per channel row; sends a real test payload and shows a `TestLogDialog` with success confirmation or the exact error string (e.g. SMTP auth failure, HTTP 401, TLS version mismatch)
- Webhook test: POSTs `alert.test` JSON payload with HMAC-SHA256 signature when a secret is set; 10 s timeout
- SMTP test: sends via nodemailer using the stored channel config; nodemailer installed as a new web dependency
- Button shows `Loader2` spinner while in flight; result dialog stays open until dismissed

**Edit notification channel** (`apps/web/app/(dashboard)/alerts/alerts-client.tsx`, `apps/web/lib/actions/alerts.ts`)
- Pencil icon button opens type-specific edit dialog (`EditWebhookDialog` / `EditSmtpDialog`) pre-filled from the safe config
- Secret/password fields labelled "leave blank to keep existing" when a value is already stored; empty submission preserves the existing credential
- `updateNotificationChannel` server action merges with the existing DB row so secrets are never lost

**SMTP encryption field** (`apps/web/lib/db/schema/alerts.ts`, `apps/web/lib/actions/alerts.ts`, `apps/web/app/(dashboard)/alerts/alerts-client.tsx`)
- `SmtpChannelConfig.secure: boolean` replaced with `encryption: 'none' | 'starttls' | 'tls'`; new `SmtpEncryption` type exported from schema
- Zod schemas and `NotificationChannelSafe` type updated throughout
- `normaliseSmtpConfig()` backward-compat function converts legacy `secure: bool` rows on read (`true → 'tls'`, `false → 'starttls'`) — no migration needed (JSONB)
- `sendTestNotification` maps encryption to nodemailer: `tls → secure: true`, `starttls → requireTLS: true`, `none → plain`
- UI: checkbox replaced with labelled `SmtpEncryptionSelect` (three options with descriptions); selecting a mode auto-fills the conventional port (465/587/25)
- Channel details column now shows encryption mode: e.g. `smtp.eu.mailgun.org:587 (STARTTLS) → ...`

**SMTP alert dispatch — Go ingest service** (`apps/ingest/internal/db/queries/alerts.sql.go`, `apps/ingest/internal/handlers/alerts.go`, `apps/ingest/internal/handlers/notify.go`)
- `SmtpChannelRow` struct and `GetEnabledSmtpChannels` query added — previously absent; SMTP channels were silently never fetched
- `smtpChannelConfig` struct with `effectiveEncryption()` handles both new `encryption` field and legacy `secure: bool`
- `sendSmtpEmail`: implements all three modes — `tls` (direct TLS via `crypto/tls` + `smtp.NewClient`), `starttls` (`smtp.Dial` + `StartTLS`), `none` (`smtp.SendMail`); `smtpSend` helper for MAIL/RCPT/DATA sequence
- `dispatchSmtp` fans out to all SMTP channels in goroutines, logging failures (best-effort, same pattern as webhooks)
- `notifChannels` struct bundles `webhooks` and `smtp` slices; `evaluateCheckStatusRule` and `evaluateMetricThresholdRule` updated to accept and dispatch to both
- All four fire/resolve points in both rule evaluators now call both `dispatchWebhooks` and `dispatchSmtp`

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 11 — Agent HTTP client fix and stream dedup reset

**HTTP check resource leak** (`agent/internal/checks/http.go`)
- Shared a single `http.Client` (with `Transport`) across all HTTP check goroutines instead of creating a new one per check — prevents file-descriptor exhaustion from accumulated idle transports on hosts with many HTTP checks
- Response bodies are now always drained before close so TCP connections are cleanly returned to the pool

**Stream dedup map reset on reconnect** (`agent/internal/heartbeat/heartbeat.go`)
- `seenQueryIDs` map is cleared at the start of each new stream session so ad-hoc queries that were pending when a stream died are re-executed on the new stream rather than silently dropped

**Build state**
- `go build ./agent/...` — compiles ✅

---

### Session 10 — SMTP email notifications and global alert defaults

**SMTP notification channel** (`apps/web/lib/db/schema/alerts.ts`, `apps/web/lib/actions/alerts.ts`, `apps/web/app/(dashboard)/alerts/alerts-client.tsx`)
- New `SmtpChannelConfig` interface: host, port, secure, optional username/password, fromAddress, fromName, toAddresses (array)
- `NotificationChannelType` union type `'webhook' | 'smtp'` replaces the hard-coded `'webhook'` literal on `notificationChannels.type`
- `notificationChannels.config` now typed as `WebhookChannelConfig | SmtpChannelConfig`
- `createNotificationChannel` action handles both channel types; SMTP passwords are redacted (`hasSecret`) the same way webhook secrets are
- Alerts page updated: Add Channel dialog has a type selector that switches between webhook and SMTP field sets; channel list renders type badge and appropriate masked credentials

**Global alert defaults** (`apps/web/lib/db/schema/alerts.ts`, migration `0009_global_alert_defaults.sql`, `apps/web/lib/actions/alerts.ts`, `apps/web/lib/actions/agents.ts`)
- New `isGlobalDefault` boolean column on `alertRules` (default false); migration `0009` adds it
- `getGlobalAlertDefaults(orgId)` — fetches all global-default rules for the org
- `createGlobalAlertDefault(orgId, input)` — creates a rule with `isGlobalDefault = true`; only `metric_threshold` type allowed for defaults
- `deleteGlobalAlertDefault(orgId, ruleId)` — soft-deletes a global default rule
- `applyGlobalDefaultsToHost(orgId, hostId)` — clones each active global-default rule as a host-scoped rule; called from `approveAgent` immediately after manual approval
- `getAlertRules` now excludes global defaults from regular host/org rule listings (prevents duplicates in the Alerts tab)

**Global Alert Defaults settings page** (`apps/web/app/(dashboard)/settings/alerts/`)
- New `page.tsx` — admin-only server component; fetches initial defaults, passes to client
- `alerts-client.tsx` — table of default metric threshold rules with Add/Delete; Add dialog: metric (cpu/memory/disk), operator, threshold %, severity
- Sidebar link "Global Alert Defaults" added under Administration

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 9 — Alert rule builder + alert state machine

**Schema** (`apps/web/lib/db/schema/alerts.ts`, migration `0008_alert_rules.sql`)
- `alertRules` table: org-scoped, hostId nullable (null = org-wide), conditionType, config JSONB, severity, enabled
- `alertInstances` table: ruleId, hostId, orgId, status (firing/resolved/acknowledged), message, triggeredAt, resolvedAt, acknowledgedAt/By
- `notificationChannels` table: orgId, name, type='webhook', config JSONB (url + optional secret), enabled

**Ingest alert evaluation** (`apps/ingest/internal/db/queries/alerts.sql.go`, `apps/ingest/internal/handlers/alerts.go`, `apps/ingest/internal/handlers/notify.go`)
- `GetAlertRulesForHost`, `GetActiveAlertInstance`, `InsertAlertInstance`, `ResolveAlertInstance`, `GetRecentCheckResults`, `GetEnabledWebhookChannels` — Go query functions
- `evaluateAlerts` called from `processHeartbeat` after check results are persisted; evaluates both `check_status` and `metric_threshold` rules
- `check_status`: fetches last N results (N = failureThreshold); fires when all failing, resolves when latest passes; guards against insufficient history
- `metric_threshold`: compares current heartbeat metric (float32→float64 cast) against threshold; fires/resolves each heartbeat cycle
- `notify.go`: `postWebhook` with HMAC-SHA256 signing, 5 s timeout, best-effort goroutine fan-out
- `processHeartbeat` signature extended with `hostname string` param; both call sites updated

**Server actions** (`apps/web/lib/actions/alerts.ts`)
- `getAlertRules(orgId, hostId?)` — uses `or(eq, isNull)` for org-wide rule inclusion
- `createAlertRule`, `updateAlertRule`, `deleteAlertRule` (soft delete), `getAlertInstances`, `acknowledgeAlert`
- `getActiveAlertCountsForHosts(orgId, hostIds[])` — GROUP BY for inventory badge
- `getNotificationChannels` (redacts secret → `hasSecret: boolean`), `createNotificationChannel`, `deleteNotificationChannel`

**Alerts page** (`apps/web/app/(dashboard)/alerts/page.tsx`, `alerts-client.tsx`)
- Replaced placeholder; server component fetches initial data, passes to client with `currentUserId`
- Active alerts table: SeverityBadge, host link, rule name, message, triggered-at, Acknowledge button
- History table: last 50 resolved/acknowledged
- Severity filter dropdown
- Notification channels section: webhook table + Add Webhook dialog (URL + optional secret; secret masked as `hasSecret` after save)

**Host detail Alerts tab** (`apps/web/app/(dashboard)/hosts/[id]/alerts-tab.tsx`)
- Host-specific rules section with Add Rule dialog (conditionType selector, check picker / metric config, severity)
- Enable/disable `<Switch>` and delete per rule; org-wide rules shown read-only in separate card
- Active alert count badge pulled via TanStack Query; shown in red if > 0
- Host detail `page.tsx` now passes `currentUserId` to `HostDetailClient`
- `host-detail-client.tsx`: new `'alerts'` tab with red count badge; `getAlertInstances` query for badge count

**Host inventory alert badge** (`apps/web/app/(dashboard)/hosts/hosts-client.tsx`)
- `getActiveAlertCountsForHosts` query (enabled when hosts list is non-empty)
- New "Alerts" column: red badge if count > 0, `—` otherwise

**Build state**
- `npm run build` — zero TypeScript errors ✅
- `go build github.com/infrawatch/ingest/...` — compiles ✅
- `go build github.com/infrawatch/agent/...` — compiles ✅

---

### Session 8 — Agent version pinning, TLS install flag, and cross-platform build fixes

**`--tls-skip-verify` in install flow** (`agent/cmd/agent/main.go`, `agent/internal/install/install.go`, `apps/web/app/api/agent/install/route.ts`, `apps/web/app/(dashboard)/settings/agents/agents-client.tsx`)
- New `--tls-skip-verify` CLI flag threaded through `install.Run()` → `mergeConfig()` → `writeConfig()`, writing `tls_skip_verify = true` into `agent.toml` when set — no manual config editing required after install in self-signed cert environments
- Install script route accepts `skip_verify=true` query param and appends the flag to the generated agent command
- Token creation UI adds an "Accept self-signed certificates" checkbox (checked by default) that controls whether the generated curl command includes the param

**Pinned required agent version** (`apps/web/lib/agent/version.ts`, `apps/web/app/api/agent/download/route.ts`, `apps/web/lib/agent/cache-prewarm.ts`)
- `lib/agent/version.ts` — new module with `REQUIRED_AGENT_VERSION` constant; single source of truth for which agent version a given server release requires
- Cache-prewarm fetches the specific GitHub release tagged `agent/<version>` rather than latest; logs a clear message when the release doesn't exist yet (local dev)
- Download route serves the pinned versioned binary, falling back to an unversioned locally-built binary (`make agent`) for development
- 503 error message names the missing release tag explicitly

**Version derived from release-please manifest** (`apps/web/lib/agent/version.ts`, `apps/web/Dockerfile`)
- `REQUIRED_AGENT_VERSION` is now read from `.release-please-manifest.json` at the repo root, which release-please updates automatically on every agent release — no manual version bumping required
- Dockerfile updated to copy the manifest into both builder and runner stages so it is available at container runtime
- Falls back to a hardcoded version with a console warning if the manifest cannot be found

**Cross-platform agent build fixes** (`Makefile`, `.gitignore`, `agent/internal/heartbeat/disk_linux.go`, `agent/internal/heartbeat/disk_other.go`)
- `make agent` now builds for all six platforms (linux/darwin/windows × amd64/arm64) and outputs to `apps/web/data/agent-dist/` with the correct naming convention matching the download route
- `GOCACHE`/`GOPATH` fixed so the Docker build container can write its cache under `--user`
- `readAllDisks()` extracted into `disk_linux.go` (build tag `linux`) and a stub `disk_other.go` (build tag `!linux`) so the agent cross-compiles cleanly for Windows/macOS
- `apps/web/data/` added to `.gitignore` (generated binaries)

**Build state**
- `npm run build` — zero errors ✅
- `go build ./agent/...` — compiles ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 7 — Ad-hoc agent queries (port and service discovery)

**`agent_queries` schema** (`apps/web/lib/db/schema/agent-queries.ts`)
- `agent_queries` table: org_id, host_id, query_type (`list_ports` | `list_services`), status (`pending` | `complete` | `error`), result jsonb, error_message, expires_at (2-minute TTL), requested/completed timestamps

**API routes** (`apps/web/app/api/hosts/[id]/queries/`)
- `POST /api/hosts/[id]/queries` — creates a pending query, returns query ID; auth-guarded with org membership check
- `GET /api/hosts/[id]/queries/[queryId]` — polls query status and returns result when complete; 1-second client poll interval

**Ingest: push pending queries to open streams** (`apps/ingest/internal/handlers/heartbeat.go`)
- Polls DB every 2 s for pending queries scoped to the connected host
- Pushes queries into `HeartbeatResponse.PendingQueries`; agent processes and returns results in ~2–3 s rather than waiting for the 30 s heartbeat
- Saves completed results back to `agent_queries`, updating status from `pending` → `complete` (or `error`)
- Normalises agent-returned status `"ok"` → `"complete"` so UI renders correctly

**Agent query executor** (`agent/internal/queries/`)
- Handles `list_ports`: reads `/proc/net/tcp`, `/proc/net/tcp6`, `/proc/net/udp`, `/proc/net/udp6`; resolves inode → process name via `/proc/<pid>/fd/`; returns port, protocol, optional process name
- Handles `list_services`: reads systemd unit files and status via `systemctl list-units`; returns service name, description, status
- Responses drain into each heartbeat request alongside check results

**UI — "Query server" in Add Check dialog** (`apps/web/app/(dashboard)/hosts/[id]/checks-tab.tsx`)
- "Query server" button in the Add Check dialog triggers `list_ports` or `list_services` depending on check type
- Polls the GET endpoint every second until complete; renders a clickable list of discovered ports/services
- Clicking a result auto-populates the port/name field in the check config form

**Build state**
- `npm run build` — zero errors ✅
- `go build ./agent/...` — compiles ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 3b — Agent distribution, self-update, and one-command install

_(Built between Sessions 3 and 4; not previously documented)_

**Automated releases via release-please + GitHub Actions** (`.github/workflows/agent-release.yml`, `release-please-config.json`)
- Conventional commits on `agent/` paths trigger release-please PRs
- On merge, GitHub Actions builds agent binaries for all platforms (linux/darwin/windows × amd64/arm64) with build-time version injection (`-ldflags "-X main.version=<tag>"`)
- Binaries uploaded as release artifacts under `agent/vX.Y.Z` tags

**Server-hosted binaries and version-aware cache** (`apps/web/app/api/agent/download/route.ts`)
- `GET /api/agent/download?os=X&arch=Y` — fetches from GitHub Releases on first request, caches locally in `AGENT_DIST_DIR`
- Filenames are versioned (`infrawatch-agent-linux-amd64-v0.5.0`); new releases picked up automatically without cache invalidation
- 5-minute TTL check against GitHub for latest version
- Enables air-gapped deployments — server is the single binary source

**Prewarm agent binary cache on server startup** (`apps/web/instrumentation.ts`, `apps/web/lib/agent/cache-prewarm.ts`)
- `instrumentation.ts` server hook downloads all platform binaries (6 combinations) in parallel on startup
- Already-cached versions skipped; failures logged but never prevent server start
- Fresh servers are immediately ready to serve installs without a cold-cache delay on first request

**One-command install** (`apps/web/app/api/agent/install/route.ts`, `agent/cmd/agent/main.go`)
- `curl -fsSL "https://server/api/agent/install?token=TOKEN" | sh` — complete zero-touch setup
- Shell script detects OS/arch, downloads versioned binary, runs `--install --token TOKEN`
- Agent `--install` flag: copies binary to system path, writes TOML config, installs service unit, starts service
- Also supports `-address` CLI flag and `INFRAWATCH_ORG_TOKEN` / `INFRAWATCH_INGEST_ADDRESS` env vars for config-less operation
- Enrolment token dialog shows the ready-to-run curl command as the primary action

**Multi-platform service install** (`agent/internal/install/install.go`, `agent/cmd/agent/service_windows.go`)
- **Linux:** systemd unit written to `/etc/systemd/system/infrawatch-agent.service`, `systemctl enable --now`
- **macOS:** launchd plist written to `/Library/LaunchDaemons/com.infrawatch.agent.plist`, `launchctl load`
- **Windows:** binary copied to `C:\Program Files\infrawatch\`; service installed via `sc.exe` with proper Stop/Shutdown signal handling

**Agent self-update** (`agent/internal/updater/updater.go`, `apps/ingest/internal/handlers/heartbeat.go`)
- Ingest compares agent version in each heartbeat against configured latest version
- When a newer version exists, ingest sets `update_available` + `download_url` in `HeartbeatResponse`
- Agent calls `updater.Update(version, downloadURL)`: downloads to temp file, atomically replaces running binary, re-execs with same args; cleans up temp on failure

**Other fixes in this period**
- `tls_skip_verify` config option added to agent for self-signed ingest certs in dev
- Fixed: re-inviting a soft-deleted user restores them rather than attempting re-registration

**Build state**
- `npm run build` — zero errors ✅
- `go build ./agent/...` — compiles ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 6 — Check definition system (port/process/http)

**Proto additions** (`proto/agent/v1/heartbeat.proto` + `proto/gen/go/agent/v1/messages.go`)
- New `CheckDefinition` message: check_id, check_type, config_json (string), interval_seconds
- New `CheckResult` message: check_id, status (pass/fail/error), output, duration_ms, ran_at_unix
- `HeartbeatRequest` gains `check_results` field; `HeartbeatResponse` gains `checks` field

**`checks` + `check_results` schema** (`apps/web/lib/db/schema/checks.ts`)
- `checks` table: org/host scoped, check_type, config jsonb, enabled, interval_seconds, soft delete, metadata
- `check_results` hypertable: check_id, host_id, org_id, ran_at (partition key), status, output, duration_ms
- Migration `0006_icy_trish_tilby.sql` — includes TimescaleDB hypertable + 30-day retention, graceful degradation wrapped in `DO $$` block

**Ingest handler updates** (`apps/ingest/internal/handlers/heartbeat.go`)
- Resolves `hostID` once at stream start via `GetHostByAgentID` (cached for stream lifetime)
- Persists each `CheckResult` from `HeartbeatRequest` into `check_results` via `InsertCheckResult`
- Queries `GetChecksForHost(hostID)` on every heartbeat and pushes active check definitions in `HeartbeatResponse.Checks`

**Agent check executor** (`agent/internal/checks/`)
- `executor.go` — manages per-check goroutines with agent-level context (survives stream reconnects); reconciles definitions on each heartbeat; accumulates results for drain
- `port.go` — TCP dial with 5s timeout
- `process.go` — scans `/proc/<pid>/comm` and `/proc/<pid>/cmdline` to find process by name
- `http.go` — GET with 10s timeout, checks expected status code (default 200)
- `heartbeat.go` updated to drain check results into each request and update definitions from each response

**Web server actions** (`apps/web/lib/actions/checks.ts`)
- `getChecks`, `createCheck`, `updateCheck`, `deleteCheck`, `getCheckResults` — all Zod-validated, org-scoped

**Checks tab** (`apps/web/app/(dashboard)/hosts/[id]/checks-tab.tsx`)
- Expandable check rows: name, type badge, status badge, last run time
- Enable/disable toggle, delete button, inline result history
- "Add Check" dialog with type-specific config fields
- shadcn `Select` + `Switch` components added

**Build state**
- `npm run build` — zero errors ✅
- `go build ./agent/...` — compiles ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 5 — Metric history, TimescaleDB hypertable, metric graphs

**`host_metrics` TimescaleDB hypertable** (`apps/web/lib/db/schema/metrics.ts`)
- New table: `id, organisation_id, host_id, recorded_at, cpu_percent, memory_percent, disk_percent, uptime_seconds, created_at`
- Migration `0005_wet_photon.sql` creates the table, converts it to a TimescaleDB hypertable on `recorded_at`, and adds a 30-day retention policy. Wrapped in `DO $$` block for graceful degradation if TimescaleDB is not available.

**Ingest: persist metric rows** (`apps/ingest/internal/db/queries/metrics.sql.go`)
- `InsertHostMetricByAgentID` — inserts into `host_metrics` via subquery on `hosts.agent_id`; no extra round-trip needed
- Called from `processHeartbeat` on every heartbeat alongside the existing `UpdateHostVitals`

**Fix `newCUID()`** (`apps/ingest/internal/db/queries/hosts.sql.go`)
- Replaced `math/rand` with `crypto/rand` — IDs are now cryptographically random

**`getHostMetrics` server action** (`apps/web/lib/actions/agents.ts`)
- `getHostMetrics(orgId, hostId, range: '1h'|'24h'|'7d')` — queries `host_metrics` with a computed cutoff timestamp, returns rows ordered by `recorded_at` asc

**Metrics tab on host detail page** (`apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx`)
- Fourth tab: Metrics
- Range selector buttons: Last hour / Last 24 hours / Last 7 days
- Recharts `LineChart` with three lines: CPU (blue), Memory (green), Disk (amber); Y-axis 0–100 %
- Empty state when no data yet; loading state while fetching
- Refetches every 60 s; only fetches when the Metrics tab is active

**Offline period visualisation** (`apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx`)
- `getAgentOfflinePeriods(orgId, agentId, range)` server action — walks `agent_status_history` to build `{start, end}` offline windows within the visible time range; looks back one extra hour to capture periods that started before the window
- Chart X-axis domain always extends to `Date.now()` via a sentinel null point so time advances even when no new rows are arriving
- `ReferenceArea` rendered for each offline window — light gray tint (`fillOpacity: 0.15`), dark readable "Offline" label
- Zero-value boundary points injected at each offline start/end so lines visually drop to 0% during the outage and rise again on reconnect

**Build state**
- `npm run build` — zero errors ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 4 — Real system metrics, host detail page, SSE real-time streaming

**Agent metrics collection** (`agent/internal/heartbeat/heartbeat.go`)
- CPU % — two-sample `/proc/stat` delta (first call returns 0 as baseline; accurate from second sample onward)
- Memory % — `/proc/meminfo` (MemTotal − MemAvailable) / MemTotal × 100
- Disk % — `/proc/mounts` + `syscall.Statfs` per mount; pseudo-filesystems (tmpfs, devtmpfs, cgroup, proc, etc.) excluded
- Uptime — `/proc/uptime` first field converted to seconds
- OS version — `/etc/os-release` PRETTY_NAME field
- Per-disk inventory — `DiskInfo` structs (mount point, device, fs_type, total/used/free bytes, percent_used) sent in every heartbeat
- Network interfaces — `NetworkInterface` structs (name, MAC, IP addresses, is_up) via `net.Interfaces()`; loopback excluded
- OS / arch sent via heartbeat (`runtime.GOOS`, `runtime.GOARCH`)

**Ingest: HeartbeatHandler updates** (`apps/ingest/internal/handlers/heartbeat.go`)
- Persists disks and network_interfaces into `hosts.metadata` (JSONB) on every heartbeat
- Writes `os` and `arch` back to `hosts` table (were missing before)
- Syncs host status to `offline` when the gRPC stream closes
- Allows `offline` agents to reconnect and transition back to `active`

**Host detail page** (`apps/web/app/(dashboard)/hosts/[id]/`)
- `page.tsx` — server component, fetches host via `getHost(orgId, hostId)`, 404 if not found
- `host-detail-client.tsx` — tabbed UI:
  - **Overview tab**: CPU / memory / disk gauges (green ≤ 70 %, amber ≤ 90 %, red > 90 %); system info panel (hostname, OS, version, arch, uptime, IPs); agent info panel (status badge, version, agent ID, last heartbeat, registration date)
  - **Storage tab**: per-disk table (mount point, device, filesystem, total/used/free, usage %) from `host.metadata.disks`
  - **Network tab**: interface table (name, MAC, IPs extracted from CIDR, Up/Down badge) from `host.metadata.network_interfaces`

**SSE streaming** (`apps/web/app/api/hosts/[id]/stream/route.ts`)
- GET `/api/hosts/{id}/stream` — requires valid session and org membership
- Sends initial snapshot immediately on connection
- Polls DB every 5 s and pushes `update` events as SSE JSON
- Sends `error` event if host not found; closes cleanly on client disconnect (abort signal)

**useHostStream hook** (`apps/web/hooks/use-host-stream.ts`)
- `'use client'` hook consumed by `HostDetailClient`
- Opens `EventSource` to `/api/hosts/{hostId}/stream`
- Writes each `update` event directly into React Query cache key `['host', orgId, hostId]`
- Closes on unmount; auto-reconnects on remount

**Server action added**
- `getHost(orgId, hostId)` in `lib/actions/agents.ts` — single-host fetch with agent LEFT JOIN

**Agent example config** (`agent/examples/agent.toml`)
- Reference config file for operators

**Bug fixes**
- OS and architecture now correctly populated on `hosts` table at registration and heartbeat
- Host status synced to `offline` when heartbeat stream closes
- Offline agents can reconnect without manual intervention

**Build state**
- `npm run build` — zero errors ✅
- `go build ./agent/...` — compiles ✅
- `go build ./apps/ingest/...` — compiles ✅
- End-to-end smoke test passed — agent registers, approves, heartbeats, web UI updates live ✅

---

### Session 3 — Go agent, proto definitions, gRPC ingest, host inventory UI

**Proto definitions** (`proto/agent/v1/`)
- `agent.proto` — `PlatformInfo`, `AgentInfo` messages
- `registration.proto` — `RegisterRequest`, `RegisterResponse`
- `heartbeat.proto` — `HeartbeatRequest`, `HeartbeatResponse` (bidirectional stream)
- `ingest.proto` — `IngestService` with `Register` (unary) + `Heartbeat` (bidi stream)

**Generated Go proto stubs** (`proto/gen/go/agent/v1/`)
- `messages.go` — all message types as plain Go structs
- `codec.go` — JSON codec registered as "proto" (development stub; replace with `make proto` output)
- `ingest_grpc.go` — full gRPC client/server interfaces, stream types, `ServiceDesc`
- `proto/gen/go/go.mod` — `module github.com/infrawatch/proto`

**Go workspace** (`go.work` at repo root)
- References `./proto/gen/go`, `./agent`, `./apps/ingest`
- `replace` directives in each `go.mod` for local proto module

**Go agent** (`agent/`)
- `internal/config/` — TOML config + `INFRAWATCH_` env overrides
- `internal/identity/keypair.go` — Ed25519 key generation + persistence to `data_dir`
- `internal/identity/token.go` — agent state (ID + JWT) persistence to `agent_state.json`
- `internal/grpc/` — gRPC connection builder + TLS credentials (server-side, structured for mTLS)
- `internal/registration/registrar.go` — `Register` RPC, polls every 30s while pending
- `internal/heartbeat/heartbeat.go` — bidi stream, reconnects with exponential backoff
- `cmd/agent/main.go` — full startup sequence with `SIGTERM`/`SIGINT` shutdown

**Ingest service** (`apps/ingest/`)
- `internal/config/` — YAML config + `INGEST_` env overrides
- `internal/db/` — `pgxpool` setup + hand-written queries (agents, hosts, enrolment tokens)
- `internal/auth/jwt.go` — RS256 JWT issuance + `JWKS` HTTP endpoint
- `internal/queue/` — `Publisher` interface + in-process buffered channel implementation
- `internal/handlers/register.go` — full registration flow (validate token → idempotent check → insert → auto-approve)
- `internal/handlers/heartbeat.go` — JWT validation → active check → update vitals → publish to queue → mark offline on close
- `internal/grpc/` — gRPC server wiring with unary+stream interceptors (logging, panic recovery)
- `internal/tls/` — TLS credential builder (structured for mTLS)
- `cmd/ingest/main.go` — startup with DB connect, JWT issuer, queue, gRPC + JWKS HTTP servers
- `Dockerfile` — multi-stage Go build

**Drizzle schema additions**
- `lib/db/schema/agents.ts` — `agents`, `agent_status_history`, `agent_enrolment_tokens` tables
- `lib/db/schema/hosts.ts` — `hosts` table (stores latest vitals per heartbeat)
- `lib/db/schema/resource_tags.ts` — universal `key:value` tag join table (two indexes)
- `lib/db/schema/index.ts` — updated with three new exports

**Server actions** (`lib/actions/agents.ts`)
- `listPendingAgents(orgId)` — pending agents for admin approval
- `approveAgent(orgId, agentId, actorId)` — sets status active + appends history
- `rejectAgent(orgId, agentId, actorId)` — sets status revoked + appends history
- `listHosts(orgId)` — left join with agents, returns `HostWithAgent[]`
- `createEnrolmentToken(orgId, userId, input)` — creates token with label/auto-approve/maxUses/expiry
- `listEnrolmentTokens(orgId)` — active tokens for org
- `revokeEnrolmentToken(orgId, tokenId)` — soft delete

**Web UI**
- `app/(dashboard)/hosts/page.tsx` — server component (replaced placeholder, fetches initial data)
- `app/(dashboard)/hosts/hosts-client.tsx` — TanStack Query, hosts inventory table, pending agents panel with Approve/Reject, auto-refresh every 30s
- `app/(dashboard)/settings/agents/page.tsx` — admin-only server component
- `app/(dashboard)/settings/agents/agents-client.tsx` — enrolment token list + create dialog (with full token reveal on creation) + revoke
- `components/shared/sidebar.tsx` — added "Agent Enrolment" link under Administration

**shadcn components added**
- `components/ui/table.tsx` — added via `shadcn add table`

**Dependencies added**
- `date-fns ^4.1.0` — date formatting in host/agent UI

**Build & deploy**
- `Makefile` — `proto`, `go-build`, `go-test`, `agent`, `ingest`, `dev-tls`, `clean` targets
- Root `package.json` — added `proto`, `go:build`, `go:test` scripts
- `docker-compose.single.yml` — added `ingest` service (port 9443 gRPC, 8080 JWKS)
- `deploy/scripts/gen-dev-tls.sh` — generates self-signed cert into `deploy/dev-tls/`
- `.gitignore` — added `deploy/dev-tls/`, `go.work.sum`

**Build state**
- `npm run build` — zero errors ✅
- `go build ./agent/...` — compiles ✅
- `go build ./apps/ingest/...` — compiles ✅

---

### Session 2 — User management, roles, feature flags, licence scaffold

**Auth middleware / proxy**
- `proxy.ts` — Next.js 16 renamed `middleware.ts` to `proxy.ts`; already implemented. Checks `better-auth.session_token` cookie; unauthenticated requests to protected routes redirect to `/login`. Full session verification (including org check) done in server components.

**Auth session helper**
- `lib/auth/session.ts` — `getRequiredSession()` fetches Better Auth session + full DB user row, redirects to `/login` if unauthenticated

**Feature flags**
- `lib/features.ts` — `hasFeature(tier, feature)` checks licence tier against feature map
- `components/shared/feature-gate.tsx` — client component that gates UI behind licence tier; renders fallback/upgrade message if not entitled

**Licence validation**
- `lib/licence.ts` — offline RS256 JWT validation with bundled dev public key; validates tier, org, expiry, and signature

**Server actions**
- `lib/actions/users.ts` — `getOrgUsers`, `inviteUser` (7-day token), `updateUserRole`, `deactivateUser`, `cancelInvite`
- `lib/actions/settings.ts` — `updateOrgName`, `saveLicenceKey` (validates via licence.ts, persists tier)

**Pages (real UI, not placeholders)**
- `app/(dashboard)/team/page.tsx` + `TeamClient` — member table, role management, invite dialog, pending invites, deactivation
- `app/(dashboard)/settings/page.tsx` + `SettingsClient` — org name editor, licence key entry with tier badge and error feedback
- `app/(dashboard)/profile/page.tsx` + `ProfileClient` — name editor, password change

**Database schema additions**
- `lib/db/schema/invitations.ts` — email, role, token, org/user refs, 7-day expiry, soft delete
- `organisations` table extended — `licenceTier`, `licenceKey`, `slug`, `logo`
- `users` table extended — `organisationId`, `role`, `isActive`, `twoFactorEnabled`

---

### Session 1 — Monorepo + Next.js scaffold + auth + Docker Compose

**Monorepo**
- Turborepo root with `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.npmrc`
- Full directory skeleton: `apps/`, `packages/`, `proto/`, `deploy/`, `docs/`, `agent/`, `consumers/`
- pnpm workspaces with root-level turbo tasks

**apps/web (Next.js 16.2.1)**
- TypeScript strict mode + `noUncheckedIndexedAccess` + `noImplicitOverride`
- Tailwind CSS v4 with shadcn/ui (Radix preset, Nova theme)
- Turbopack enabled for dev (`next dev --turbopack`)
- Standalone output enabled for Docker

**Database**
- Drizzle ORM with `postgres` driver
- Schema: `organisations`, `users`, `sessions`, `accounts`, `verifications`, `totp_credential`
- `drizzle.config.ts` pointing at `lib/db/schema/index.ts`
- All tables follow CLAUDE.md conventions (id/createdAt/updatedAt/deletedAt/metadata, soft deletes)
- Migration scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio`

**Auth**
- Better Auth v1 with email/password and TOTP two-factor plugin
- `lib/auth/index.ts` — server-side auth config with Drizzle adapter
- `lib/auth/client.ts` — client-side auth hooks (`signIn`, `signOut`, `signUp`, `useSession`)
- API route: `app/api/auth/[...all]/route.ts`

**Pages**
- `/` → redirects to `/login`
- `(auth)/login` — login form with Zod validation, React Hook Form
- `(auth)/register` — register form, posts to Better Auth
- `(setup)/onboarding` — org creation wizard, creates organisation and links user as `super_admin`
- `(dashboard)/dashboard` — overview placeholder

**Components**
- `components/shared/sidebar.tsx` — shadcn Sidebar with all nav sections (Monitoring, Tooling, Administration)
- `components/shared/topbar.tsx` — header with user dropdown + sign out
- `components/shared/query-provider.tsx` — TanStack Query provider
- `components/ui/` — shadcn primitives

**Infrastructure**
- `docker-compose.single.yml` — TimescaleDB/PostgreSQL + Next.js
- `apps/web/Dockerfile` — multi-stage build (deps → builder → runner), node:22-alpine

---

## Decisions Made This Far (beyond CLAUDE.md)

1. **Next.js 16.2.1** — Latest stable at time of session. In Next.js 16, `middleware.ts` is renamed to `proxy.ts` and the export is `proxy()` instead of `middleware()`.
2. **Tailwind CSS v4** — create-next-app installs this; shadcn Nova preset works with it
3. **Better Auth v1 Drizzle adapter** — `better-auth/adapters/drizzle` (built-in)
4. **Zod v4** — uses `.issues` not `.errors` on `ZodError`
5. **Proto JSON codec stub** — `codec.go` in `proto/gen/go/agent/v1/` registers a JSON codec as "proto" so the Go code compiles and works without running protoc. Run `make proto` (requires protoc + plugins) to replace with proper protobuf encoding, then remove `codec.go`.
6. **Agent JWT flow** — agent stores JWT as a string; ingest issues RS256 JWT keyed to agent_id. Agent's `HeartbeatRequest.agent_id` field is used to carry the JWT for stream authentication on the first message.
7. **ID generation in ingest** — uses a simple random ID generator (`newCUID()` in `hosts.sql.go`). This should be replaced with a proper cuid2 equivalent before production.
8. **`golang.org/x/sys`** — removed from agent module (was unused after switching from `unix.Gethostname` to `os.Hostname()`).

---

## Known Issues / Technical Debt

- `codec.go` is a development stub — replace with protoc-generated files by running `make proto` (requires `protoc`, `protoc-gen-go`, `protoc-gen-go-grpc`)
- `newCUID()` in ingest DB queries now uses `crypto/rand` ✅
- Docker Compose does not auto-run migrations on startup
- `gen_cuid()` SQL function does not exist in PostgreSQL — `InsertAgent` has a fallback but the primary query will fail and fall through. The fallback is correct.
- mTLS client certificates deferred — TLS builder is structured for it; deliberately deferred until Phase 1 metrics work is complete
- The `go.work.sum` file is gitignored — developers must run `go work sync` after cloning
- CPU % on first heartbeat is always 0 — by design (two-sample baseline); accurate from second heartbeat onward

---

## Blockers

_None._

---

## What The Next Session Should Build

**Session 16 — Phase 3: Certificate Management**

Phase 2 is complete. Phase 3 starts here:

1. **Agent-side cert discovery** — add a `cert` check type to the agent; scans TLS endpoints (or local cert files) and returns subject, SANs, expiry, issuer. Returns structured data over the existing gRPC stream.
2. **Certificate schema + inventory** — `certificates` table (host_id, common_name, sans, issuer, not_before, not_after, source); `db:generate` + migrate; list UI with expiry countdown badges (green/amber/red)
3. **Expiry alerting** — new alert condition type `cert_expiry` with threshold in days; ingest evaluates on each heartbeat using the stored cert data
4. **CSR generation wizard** — form to generate a CSR (key type, CN, SANs); returns PEM for admin to sign externally or with an internal CA
5. **Approval workflow** — "pending certs" queue for newly discovered certs that haven't been reviewed

**Outstanding technical debt (carry forward):**
- `codec.go` is a JSON stub — replace with protoc-generated files (`make proto` requires protoc + plugins)
- mTLS client certificates deferred — TLS builder is structured for it
- `go.work.sum` is gitignored — developers must run `go work sync` after cloning
- Metric retention setting is stored in DB but doesn't yet call `add_retention_policy` dynamically (TimescaleDB retention is fixed at 30 days until wired up)

---

## Phase Completion Checklist

### Phase 0 — Foundation
- [x] Monorepo scaffold (Turborepo)
- [x] Next.js app with shadcn/ui + Tailwind
- [x] PostgreSQL + Drizzle + migrations pipeline
- [x] Docker Compose single-node
- [ ] CI pipeline (GitHub Actions)
- [x] Better Auth — email/password + TOTP
- [x] Organisation + user schema
- [x] Basic RBAC (roles + permissions)
- [x] User management UI
- [x] Feature flag system
- [x] Licence key validation scaffold
- [x] Auth middleware (route protection)
- [ ] System health / about page

### Phase 1 — Agent & Host Inventory
- [x] Go agent scaffold
- [x] Proto definitions
- [x] gRPC ingest service
- [x] Agent registration + approval flow (UI + ingest handler)
- [x] Heartbeat + online/offline detection
- [x] Host inventory UI
- [ ] mTLS identity (deferred)
- [x] Agent self-update mechanism (ingest-signalled, atomic binary swap)
- [x] Agent one-command install (curl | sh, systemd/launchd/SCM)
- [x] Server-hosted binaries with version-aware cache + prewarm
- [x] Automated agent releases (release-please + GitHub Actions)
- [ ] Redpanda integration (deferred)
- [ ] Metrics consumer (deferred)
- [x] Real-time status indicators (SSE stream + useHostStream hook)
- [x] Integration smoke test (end-to-end agent → UI)

### Phase 2 — Monitoring & Alerting
- [x] Check definition system
- [x] Check types — port, process, http (shell/file deferred)
- [x] Ad-hoc agent queries (list_ports, list_services — used in check creation UI)
- [x] TimescaleDB continuous aggregates (host_metrics_hourly + host_metrics_daily)
- [x] Metric retention policies (configurable per-org in settings, default 30 days)
- [x] Metric graphs (Recharts)
- [x] Alert rule builder (check_status + metric_threshold, per-host + org-wide)
- [x] Alert state machine (fire/resolve in ingest; acknowledge in web)
- [x] Notification channels (webhook with HMAC-SHA256 signing)
- [x] Alert silencing
- [x] Alert acknowledgement
- [x] Alert history pagination + date/severity filter

### Phase 3 — Certificate Management
- [ ] Agent-side cert discovery
- [ ] Certificate parser
- [ ] Certificate inventory UI
- [ ] Expiry alerting
- [ ] CSR generation wizard
- [ ] Approval workflow
- [ ] Internal CA management

### Phase 4 — Service Accounts & Identity
- [ ] Service account inventory
- [ ] Expiry tracking + alerting
- [ ] SSH key inventory
- [ ] LDAP/AD integration

### Phase 5 — Infrastructure Tooling
- [ ] Jenkins plugin bundler (port existing)
- [ ] Docker image bundler
- [ ] Ansible collection bundler
- [ ] Terraform provider bundler
- [ ] Runbook library
- [ ] Scheduled task runner

### Phase 6 — Enterprise
- [ ] SAML 2.0
- [ ] OIDC
- [ ] Advanced RBAC + resource scoping
- [ ] Audit log
- [ ] Compliance packs
- [ ] White labelling

### Phase 7 — Cloud SaaS
- [ ] Multi-tenant hardening
- [ ] Usage metering
- [ ] Billing (Stripe)
- [ ] Customer portal
