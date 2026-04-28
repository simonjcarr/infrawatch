# PROGRESS.md — CT-Ops Build State
> This file is updated at the END of every Claude Code session.
> It is the source of truth for what exists, what works, and what comes next.
> Read this at the START of every session before doing anything.

---

## Current Phase
**Phase 5 — Tooling + release hardening (in progress)**

## Current Status
🟢 Phase 5 progressing — tooling has expanded beyond Directory User Lookup and SSL Certificate Checker into Jenkins/GitLab air-gap bundle generation, recursive plugin dependency resolution, offline install bundles, host-mediated bundle transfer, and better transfer/download status. Since the last update the platform has also had a substantial release-hardening pass: local auth email verification, login lockout, self-service password reset for local accounts, shared database-backed auth and abuse throttles across replicas, trusted-origin mutation checks, org-authenticated server actions, enrolment-token limits, certificate-checker SSRF and parsing hardening, signed-update enforcement, terminal SSH credential enforcement, heartbeat/JWT tightening, agent script limits, ingest gRPC caps, config-file permission validation, digest-pinned customer bundles, installer checksum verification, and broader E2E/process coverage.

---

## What Has Been Built

### Session 75 — Admin ingest and agent health visibility

**System health operations view** (`apps/web/app/(dashboard)/settings/system/`, `apps/web/app/api/system/health/route.ts`)
- Expanded the admin-only **Administration → System** page with ingest server status, live processing counts, last-hour received message totals, queue depth, memory usage, goroutines, and DB connection usage.
- Added a central Agent Errors table combining recent certificate signing, agent query, software inventory, and task-run failures by host/agent so admins can inspect operational agent failures in one place.
- Added an agent upgrade summary showing the required agent version and the count of active/offline agents that have not upgraded.

**Ingest telemetry persistence** (`apps/ingest/internal/monitoring/`, `apps/web/lib/db/schema/ingest.ts`)
- Added `ingest_server_snapshots` and ingest-side periodic reporting so each ingest process writes process identity, active request count, received message total, queue stats, Go runtime memory/goroutines, and pgx pool usage.
- Added gRPC interceptors to count unary and stream messages and active requests without changing handler behavior.

**Validation**
- Added unit coverage for ingest and agent health summary calculations.
- Added database-backed E2E coverage for the System page with seeded ingest snapshots and agent errors.
- Validation run: `pnpm --filter web exec node --experimental-strip-types --test lib/system/health.test.mjs`, `pnpm --filter web type-check`, `pnpm --filter web lint` (existing warnings only), `pnpm --filter web db:validate`, `go test ./apps/ingest/internal/...`, and `pnpm --filter web test:e2e tests/e2e/settings/system-health.spec.ts`.
- This satisfies the requested admin visibility for ingest server status, historical message counts, resource usage, central agent errors, and not-upgraded agent counts.

### Session 74 — Vulnerability management interface

**Vulnerability operations UI** (`apps/web/app/(dashboard)/settings/vulnerabilities/`, `apps/web/lib/actions/vulnerabilities.ts`)
- Added an admin-only **Administration → Vulnerabilities** page that shows vulnerability feed/API connection status, upstream API URLs, last attempt/success times, pulled record counts, and recent connection errors without exposing secrets.
- Added a live CVE catalog view backed by `vulnerability_cves`, including pulled CVE counts, severity/KEV summaries, affected-package rule counts, source filtering, and CVE/title search so users can confirm API data is present independently of host findings.
- Added a bounded, rate-limited server action for the management snapshot, with organisation admin authorization and org-scoped open finding counts.
- Added sync policy visibility plus expected feed rows for NVD, CISA KEV, Debian, Ubuntu OSV, Alpine SecDB, and Red Hat, so the page shows the APIs CT-Ops is supposed to contact even before the first sync attempt. Ingest now stores the attempted upstream URL in source metadata for accurate display after environment overrides.
- Added an admin NVD API key control to **Administration → Vulnerabilities**. The key is stored encrypted in `system_config` as `vulnerability_nvd_api_key`; ingest uses it when `NVD_API_KEY` is not set, while keeping the environment variable as the deployment-level override.

**Validation**
- Added database-backed E2E coverage for seeded API source states, pulled CVEs, and NVD API key save/clear behavior at `/settings/vulnerabilities`.
- Validation run: `pnpm --filter web type-check`, targeted `pnpm --filter web lint -- ...`, `pnpm --filter web db:validate`, `pnpm --filter web test:e2e tests/e2e/settings/vulnerabilities.spec.ts`, and `go test ./apps/ingest/internal/vuln ./apps/ingest/internal/crypto ./apps/ingest/internal/config`.
- This completes the requested visibility for CVEs being pulled from vulnerability APIs and the status of vulnerability API connections. Manual sync triggering remains outside this interface.

### Session 72 — Linux OS package CVE checking

**Vulnerability intelligence and matching** (`agent/internal/tasks/`, `apps/ingest/internal/vuln/`, `proto/agent/v1/ingest.proto`)
- Added Linux software inventory metadata for distro identity, codename, source package, epoch/release, repository, and origin so CVE matching can use vendor package advisory truth instead of fuzzy package-name or CPE matching.
- Added ingest-side vulnerability feed sync support for CISA KEV, NVD CVE enrichment, Debian Security Tracker, Ubuntu OSV, Alpine SecDB, and Red Hat security data, with source sync state, ETag/hash handling, retry/backoff, and configurable cadence.
- Added distro-aware version comparison plus asynchronous host matching after feed syncs and software inventory ingestion; unsupported package sources are left unassessed rather than treated as safe.

**Persistence and reporting** (`apps/web/lib/db/schema/`, `apps/web/lib/actions/vulnerabilities.ts`, `apps/web/app/(dashboard)/reports/vulnerabilities/`)
- Added normalized CVE catalog, vulnerability source state, affected package ranges, and per-host finding tables, scoped by organisation for host findings.
- Added the Pro-gated **Reports → Vulnerabilities** page with filters for CVE, package, severity, KEV, fix availability, host group, distro, and package source.
- Added an **Inventory → Vulnerabilities** host detail tab showing CVE findings for a selected host.

**Validation**
- Added parser, version comparator, match-rule, agent metadata extraction, and database-backed E2E coverage for report and host vulnerability display.
- V1 scope is Linux OS packages from `dpkg`, `rpm`, and `apk`; Windows, macOS apps, Homebrew, Snap, Flatpak, Pacman/Arch, and third-party application registry matching remain out of scope and unassessed.

### Session 73 — Build document builder

**Build Docs product area** (`apps/web/app/(dashboard)/build-docs/`, `apps/web/lib/actions/build-docs.ts`, `apps/web/lib/db/schema/build-docs.ts`)
- Added a new Build Docs workspace for organisation-level build document templates, reusable snippets, structured reorderable sections, screenshot/image assets, browser preview, and PDF/DOCX exports.
- Added immutable template versions, snippet provenance on inserted sections, document/section revision snapshots, Postgres full-text search vectors, and org-scoped RLS-backed database tables.
- Added filesystem-backed image storage by default plus S3-compatible storage settings and storage adapter support for object storage deployments.
- Replaced the placeholder Runbooks route with a redirect to Build Docs and added Build Docs to navigation and the command palette.

**Validation**
- Added unit coverage for template required/optional field validation, deterministic section ordering, snippet snapshots, asset validation, and render-model table-of-contents/image attachment.
- Added database-backed E2E coverage for admin template/snippet creation, build doc creation, section editing, image upload, preview, search, and export links.
- Validation run: `pnpm --filter web test:unit`, `pnpm --filter web type-check`, `pnpm --filter web lint`, `pnpm --filter web db:validate`, `pnpm --filter web test:e2e tests/e2e/build-docs/build-docs.spec.ts`, and `BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=... DATABASE_URL=postgres://ctops:ctops@127.0.0.1:5432/ctops pnpm --filter web build`.

### Session 71 — Customer support data bundle

**Support diagnostics tooling** (`deploy/customer-bundle/generate_support_data`, `.github/workflows/`, `apps/docs/docs/`)
- Added a customer-bundle `generate_support_data` executable that writes a timestamped `ct-ops-support-data-*.tar.gz` beside `docker-compose.yml`.
- The archive includes sanitized `.env`/compose data, Docker status, recent compose logs, host information, file metadata, and TLS certificate fingerprints while excluding raw `.env` files, private keys, and database dumps.
- Release and customer-bundle checks now stage and syntax-check the executable so it ships with the install bundle at the same level as `docker-compose.yml`.

**Validation**
- Added `deploy/scripts/test-support-data.sh` to verify support bundle generation and redaction of env secrets, compose-rendered secrets, and log bearer/password values.

### Session 70 — Patch status monitoring and management reporting

**Patch status check** (`agent/internal/checks/patch_status.go`, `apps/web/lib/actions/checks.ts`, `apps/web/app/(dashboard)/hosts/[id]/checks-tab.tsx`)
- Added a `patch_status` check type with configurable `max_age_days` and capped `max_packages`.
- Linux agents determine last patch age and list available package updates for apt, dnf/yum, zypper, pacman, and apk using read-only package-manager commands.
- Windows agents report patch age from hotfix data and mark package update listing unsupported; macOS reports patch age from `softwareupdate --history` where available and marks update listing unsupported.
- Check pass/fail is based only on patch age; available package updates are reported but do not directly fail the check.

**Persistence and reporting** (`apps/web/lib/db/schema/patch-status.ts`, `apps/ingest/internal/handlers/patch_status.go`, `apps/web/lib/actions/patch-status.ts`)
- Added `host_patch_statuses` for latest per-host/check patch health and `host_package_updates` for current/resolved available package updates.
- Ingest now persists structured `patch_status` check output and refreshes current available update rows on every supported result.
- Added `/reports/patch-status` management report with estate summary, network patch status, and host-level patch status including network memberships.

**Host detail drill-down** (`apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx`, `apps/web/app/(dashboard)/hosts/[id]/patch-status-tab.tsx`)
- Added an Infrastructure → Patch Status sub-tab showing the selected host's patch age, policy threshold, last checked time, package manager, warnings/errors, and available package updates where supported.

**Validation**
- Added agent parser/evaluator unit coverage for apt, rpm, Windows hotfix JSON, and patch-age-only pass/fail behavior.
- Added database-backed E2E coverage for the host Infrastructure → Patch Status tab with seeded patch status and package updates.
- Validation run: `go test ./agent/internal/checks ./apps/ingest/internal/...`, `pnpm --filter web type-check`, `pnpm --filter web lint -- ...`, `pnpm --filter web db:validate`, and `pnpm --filter web test:e2e -- tests/e2e/hosts/patch-status.spec.ts`.

### Session 69 — Local account password reset flow

**Self-service password reset** (`apps/web/app/(auth)/forgot-password/`, `apps/web/app/reset-password/`, `apps/web/lib/auth/`)
- Added a local-account password reset entry point from the email/password login form so users who forgot their password are no longer stranded at sign-in.
- Wired Better Auth's reset capability into CT-Ops by configuring `sendResetPassword`, revoking existing sessions on reset, and sending captured/SMTP password-reset emails through the shared auth email helper.
- Added a reset request page plus a token-based reset form that validates new passwords, safely constrains post-reset redirects to in-app paths, and returns the user to `/login?reset=1` with a success notice after the password changes.

**Validation**
- Added targeted E2E coverage for requesting a reset from the login page, consuming the reset email, setting a new password, and signing in with the updated credential.
- Validation run: `pnpm --dir apps/web test:e2e tests/e2e/auth/login.spec.ts` and `pnpm --dir apps/web type-check`.

### Session 68 — Centralised authz guards

**Shared authz guard layer** (`apps/web/lib/auth/guards.ts`, `apps/web/lib/actions/`, `apps/web/lib/eslint/`, `SECURITY.md`)
- Added shared web authz helpers for active-user, same-org, admin-role, and writable-role checks so role and organisation enforcement lives in one place instead of being reimplemented ad hoc across server actions.
- Migrated the remaining raw `session.user` authorisation checks in org settings, networks, notes, certificates, terminal, task schedules, software inventory, notifications, users, and security actions onto the shared helpers or the existing `requireOrgAccess` / `requireOrgAdminAccess` wrappers.
- Added a local ESLint rule that rejects direct `session.user.organisationId` / `session.user.role` comparisons and role-list `includes()` checks in web auth/action code, and marked security finding `I-10` complete.

**Validation**
- Added focused unit coverage for the new guards and the new ESLint rule.
- Validation run: `pnpm --filter web exec node --experimental-strip-types --test lib/actions/action-auth.test.mjs lib/auth/guards.test.mjs lib/eslint/no-single-table-select.test.mjs lib/eslint/no-raw-session-checks.test.mjs`, `pnpm --filter web exec eslint lib/actions/users.ts lib/actions/security.ts lib/actions/notification-settings.ts lib/actions/settings.ts lib/actions/networks.ts lib/actions/software-inventory.ts lib/actions/terminal.ts lib/actions/task-schedules.ts lib/actions/notes.ts lib/actions/notes-resolver.ts lib/actions/certificates.ts lib/actions/action-auth-core.ts lib/auth/guards.ts lib/eslint/no-raw-session-checks.mjs lib/eslint/no-raw-session-checks.test.mjs`, and `pnpm --filter web type-check`.

### Session 67 — Administration information architecture

**Administration layout** (`apps/web/components/shared/sidebar.tsx`, `apps/web/app/(dashboard)/settings/`)
- Replaced the old Administration sidebar grouping of Team plus nested Settings with high-level areas: People, Organisation, Agents, Monitoring, Integrations, Security, and System.
- Split the settings UI into focused pages with tabs: Organisation profile/licence, Agents enrolment/defaults/tag rules/software inventory, Monitoring alert defaults/notification policy/metric retention, Integrations LDAP/SMTP, and Security mTLS/terminal access.
- Kept compatibility redirects for the old Alert Defaults, LDAP, and Tag Rules settings URLs, and updated in-app links plus onboarding/agent docs to point at the new locations.

**Validation**
- Validation run: `pnpm --filter web type-check` and `pnpm --filter web lint` (lint passed with the repository's existing warnings).

### Session 66 — SMTP relay test recipient prompt

**SMTP relay testing UX** (`apps/web/app/(dashboard)/settings/settings-client.tsx`, `apps/web/lib/actions/notification-settings.ts`, `apps/web/lib/notifications/smtp-settings.ts`)
- Changed the central SMTP Relay **Test** button to open a modal that asks which email address should receive the test message.
- The backend test action now validates a single requested recipient and sends the test email there instead of defaulting to the configured sender address.
- The modal remains open after sending and shows a sanitized SMTP test log with recipient, relay endpoint, sender, auth mode, host validation, and final success/error status without exposing credentials.

**Validation**
- Added focused unit coverage for SMTP test-recipient normalization.
- Validation run: `pnpm --filter web exec node --experimental-strip-types --test lib/notifications/smtp-settings.test.mjs`, `pnpm --filter web type-check`, and `pnpm --filter web test:unit`.

### Session 65 — Query-style lint guard for auditability

**Drizzle query-style convergence** (`apps/web/eslint.config.mjs`, `apps/web/lib/eslint/`, `apps/web/lib/actions/`, `apps/web/app/api/admin/hosts/bulk-delete/route.ts`)
- Added a local ESLint rule that rejects straightforward single-table `db.select().from(...)` and `tx.select().from(...)` reads, while still allowing query-builder paths that need joins, grouping, or aggregate SQL.
- Normalised the remaining simple single-table reads in licence, tags, notes, tag-rule preview, agent cleanup/collision helpers, software inventory filters, and the admin bulk-delete route onto `db.query.*` / `tx.query.*`.
- This satisfies security finding `I-07` / issue `#366` by making the preferred read pattern explicit and enforceable without forcing a risky broad rewrite of aggregate/reporting queries.

**Validation**
- Added focused unit coverage for the custom ESLint rule so future regressions fail close to the policy.

### Session 64 — Penetration testing scope and rules of engagement

**Security engagement documentation** (`PENTEST.md`)
- Added a repo-root penetration testing scope document alongside `SECURITY.md` and `SECURITY_DISCLOSURE.md`.
- Defined the authorised contact paths, in-scope CT-Ops components, allowed testing categories, rules of engagement, and explicit out-of-scope targets/activities for coordinated assessments.
- This satisfies issue `#365` by giving testers and operators a single source of truth for pentest scope and engagement boundaries.

**Build state**
- Documentation-only change; tests not run

### Session 63 — Shared database-backed security throttles

**Distributed auth and abuse controls** (`apps/web/lib/rate-limit.ts`, `apps/web/lib/auth/`, `apps/web/lib/db/schema/security-throttles.ts`)
- Added a shared `security_throttles` table plus a DB-backed throttle store so security-sensitive rate limits and login lockouts survive restarts and apply consistently across multiple web replicas.
- Converted the reusable rate limiter, password login lockout guard, and verification-resend throttles to use shared persisted state instead of process-local maps.
- Applied the shared guards to LDAP login, Better Auth email/password sign-in hooks, verification resend, invite lookups/acceptance, agent download/install/latest endpoints, enrolment-token creation, SMTP relay tests, software inventory scans/reports, certificate URL tracking, and alert test notifications.
- Kept the lightweight proxy-level auth limiter as a best-effort local fast-path while moving authoritative enforcement into server routes and auth hooks.

**Test and migration coverage**
- Added focused unit coverage proving rate-limit and login-lockout state is shared across separate guard instances when backed by the same store.
- Added the `security_throttles` migration and E2E harness cleanup coverage so auth throttling state is truncated between Playwright specs.
- Validation run: `pnpm --filter web type-check`, `pnpm --filter web db:validate`, `node --experimental-strip-types --test apps/web/lib/rate-limit.test.mjs apps/web/lib/auth/login-attempts.test.mjs apps/web/lib/auth/email-verification-rate-limit.test.mjs`, and `pnpm --filter web test:e2e -- tests/e2e/auth/login.spec.ts tests/e2e/auth/register.spec.ts`.

### Session 62 — Central SMTP relay settings

**Notification email delivery** (`apps/web/lib/actions/notification-settings.ts`, `apps/web/app/(dashboard)/settings/settings-client.tsx`, `apps/web/lib/notifications/`)
- Moved SMTP relay configuration out of per-alert channels and into organisation Settings as a central SMTP relay.
- Added admin-only save/test actions for the relay; SMTP passwords are encrypted before storage and redacted from client responses.
- Backend validation now restricts SMTP ports and rejects private/reserved relay hosts when the relay is enabled.
- Alert email channels now store only channel name and recipient addresses; relay host, credentials, encryption, and sender identity come from central settings.

**Alert dispatch** (`apps/web/lib/actions/alerts.ts`, `apps/ingest/internal/handlers/notify.go`, `apps/ingest/internal/db/queries/alerts.sql.go`)
- Web test notifications and ingest alert delivery now combine central relay settings with each email channel's recipients.
- Ingest keeps backward-compatible fallback support for legacy SMTP channel rows that still contain relay details.

**Test coverage**
- Added web unit coverage for SMTP recipient normalisation, relay redaction, and delivery through an in-process mock SMTP server.
- Added ingest Go coverage for SMTP delivery through an in-process mock SMTP server.

### Session 61 — Agent guidance and E2E harness documentation

**Agent operating rules** (`AGENTS.md`)
- Added an E2E Database Harness section that points agents to `apps/docs/docs/development/testing.md` as the source of truth for the web E2E harness, avoiding duplicated setup details that can drift
- Added rules requiring the database-backed harness when tests depend on real SQL, migrations, constraints, auth/session rows, organisation scoping, cascades, or persisted state
- Added rules requiring explicit, relevant seed data for tests instead of relying on leaked state
- Added Progress Tracking guidance: when new feature work satisfies all or part of a requirement, update `PROGRESS.md` and state what is complete versus outstanding
- Added Completion Cleanup guidance: remove temporary worktrees only after commit, push, release, and any relevant image/artifact publication, and never delete worktrees with uncommitted user work
- Added unrelated-finding guidance: when an agent identifies an unrelated error, bug, or security risk, it should create a focused GitHub issue so the finding is tracked instead of forgotten

**E2E harness docs** (`apps/docs/docs/development/testing.md`)
- Expanded the Playwright/Testcontainers documentation with agent-ready detail on how the tmpfs TimescaleDB/Postgres database is created, how `DATABASE_URL` is injected before Next.js starts, and how migrations run
- Documented `getTestDb()` for direct SQL seeding, when to seed through SQL versus UI/API paths, and how the baseline `seedOrgAndUser()` fixture works
- Added guidance for feature-specific seed helpers, isolation maintenance, updating `APP_TABLES` for new app tables, single-spec runs, and common troubleshooting

**Build state**
- Documentation-only change; tests not run

### Session 60 — Configurable local email verification + TLS deployment docs

**Email verification policy** (`apps/web/lib/auth/env.ts`, `apps/web/lib/auth/index.ts`, `apps/web/app/(auth)/register/`)
- Local email/password sign-up now reads `REQUIRE_EMAIL_VERIFICATION`, defaulting to `true` for the secure deployment posture.
- When verification is disabled intentionally (`REQUIRE_EMAIL_VERIFICATION=false`), registration signs the new user in and continues to the callback/onboarding flow instead of routing through the verification email gate.
- Invalid boolean values are rejected early by the shared auth env helper.
- Root `.env.example`, `apps/web/.env.example`, `docker-compose.single.yml`, customer-bundle README, and VuePress install/configuration/deployment docs now expose the variable and explain the default.

**Test coverage**
- `apps/web/lib/auth/env.test.mjs` covers the default, explicit `true`/`false`/`1`/`0`, and invalid values.
- `apps/web/tests/e2e/auth/register.spec.ts` now verifies both modes: default verification-required behaviour and the no-verification opt-out path.
- New npm script: `pnpm --filter web test:e2e:no-email-verification`.

---

### Session 59 — Security, auth, and tenant-bound action hardening

**Authentication and account controls** (`apps/web/lib/auth/`, `apps/web/app/(auth)/`)
- Local email/password sign-ups require email verification before dashboard access by default.
- Per-account login lockout added for repeated failed password attempts.
- Production auth config is now validated via `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and trusted origins instead of silently accepting unsafe defaults.
- LDAP login links are scoped to organisation context; team-management mutations derive the actor from the session.

**Mutation and tenancy boundaries** (`apps/web/lib/actions/`, `apps/web/lib/security/trusted-origins.ts`)
- Server actions now require an authenticated organisation context across agents, alerts, certificates, checks, host groups/settings, LDAP, networks, notes, notifications, service accounts, settings, software inventory, tag rules, tasks, terminal, and users.
- Trusted-origin validation added for mutation routes such as agent bundles, host queries, bundle transfer, and certificate checker calls.
- Notification test targets block private/internal addresses.

**Agent, ingest, and tool security**
- Terminal access now requires explicit SSH credentials and no longer depends on the agent-side terminal implementation.
- Heartbeat JWT handling tightened: initial heartbeat sends JWT, invalid fallback is rejected, and unsigned agent self-update is disabled.
- Enrolment tokens now enforce expiry and usage caps, with policy tests and migration support.
- Certificate checker surface hardened against SSRF and untrusted certificate parsing now uses Node's `X509Certificate`.

**Build/test coverage added**
- Unit tests added around auth env validation, login attempts, trusted origins, enrolment token policy, certificate fetch/policy, heartbeat JWT handling, and agent update policy.
- E2E coverage expanded for login, registration, authenticated redirects, settings, and activation-token flows.

---

### Session 58 — Agent, ingest, and task runtime hardening

**Agent task execution** (`agent/internal/tasks/`)
- Custom script tasks are constrained with OS-specific process-limit helpers and kill handling.
- Script timeout behaviour now preserves inherited/default limits instead of accidentally dropping them.
- Patch/task execution tests cover the new boundaries.

**Agent config safety** (`agent/internal/config/`, `agent/internal/install/install.go`)
- Agent config loading validates file ownership and permissions on Unix, with Windows-specific fallback handling.
- Installer writes config files with stricter mode expectations and tests verify the new guardrails.

**Ingest transport limits** (`apps/ingest/internal/grpc/server.go`)
- gRPC server now caps message and stream limits, backed by a new server test suite.
- JWKS/health HTTP server has a `ReadHeaderTimeout` to remove slowloris exposure.

---

### Session 57 — Release packaging and customer-bundle hardening

**Customer release artifacts** (`.github/workflows/`, `docker-compose.single.yml`, `deploy/`)
- Customer compose bundles now ship digest-pinned image references instead of mutable tags.
- Release workflow exports customer-bundle image references and the bundle check workflow validates them.
- Installer bundle checksums are generated and verified by release checks; `deploy/scripts/test-install.sh` exercises install output integrity.
- Web image startup no longer runs as root; Docker build reliability improved with retry handling for flaky `pnpm install`.

**Dependency and CI upkeep**
- BuildKit image pinned for Docker builds.
- Go, GitHub Actions, production npm dependencies, dev dependencies, and `@types/archiver` were bumped through Dependabot/release PRs.
- Release-please continued producing web/agent/ingest tags through the hardening work.

---

### Session 56 — Jenkins and GitLab air-gap bundler expansion

**Jenkins bundler** (`apps/web/app/(dashboard)/bundlers/jenkins-bundler.tsx`, `apps/web/app/api/tools/jenkins-bundler/route.ts`, `apps/web/lib/jenkins/update-center.ts`)
- Jenkins LTS metadata is queried instead of relying on hard-coded Java compatibility baselines.
- Offline-script bundle flow added for air-gap installation.
- Recursive plugin dependency traversal added so required plugin dependencies are pulled into the archive.
- A dependency pull action and clearer plugin download status make long bundle generation easier to monitor.

**GitLab bundler** (`apps/web/app/(dashboard)/bundlers/gitlab-bundler.tsx`, `apps/web/app/api/tools/gitlab-bundler/route.ts`)
- GitLab air-gap bundler added alongside Jenkins.
- Target GitLab version can be fetched from upstream metadata instead of typed manually.
- Bundle archives can be streamed server-side and transferred to selected hosts through the existing agent/task path.

---

### Session 55 — Engineering process and release-gate rules

**Repository operating rules** (`CLAUDE.md` / agent instructions)
- Security and PR workflow rules added to keep future changes aligned with the hardening work.
- Conventional PR title requirements documented.
- Completion criteria now require relevant tests to pass before a task is considered done.

**Verification posture**
- The project now has broader E2E coverage around auth/settings, more focused unit coverage for security-sensitive helpers, and CI/release checks for customer bundle integrity.

---

### Session 54 — Bundler transfer via agent task channel

**GitLab/Jenkins bundle transfer** (`apps/web/app/api/tools/bundle-transfer/route.ts`, `apps/web/app/(dashboard)/bundlers/`)
- Removed the direct SSH/SFTP transfer path from the web container; transfers now prepare the zip server-side and dispatch a `custom_script` task to the selected online host.
- The host receives the task through the existing agent heartbeat/task channel, creates the destination directory, downloads the prepared zip with a short-lived per-job token, and writes it to the requested path.
- Transfer modal is now single-step: select host, optional owner, and destination directory. No SSH password is requested or sent from the browser.
- Status panel keeps the existing download phase and then shows the separate host transfer phase while the agent task is pending/running/completed/failed.
- Removed the direct `ssh2` dependency from the web package; remaining `ssh2` lockfile entries are transitive dev dependencies of `testcontainers`.

**Build state**
- `pnpm --filter web type-check` — zero errors ✅
- `pnpm --filter web lint -- app/api/tools/bundle-transfer/route.ts 'app/(dashboard)/bundlers/bundle-transfer-dialog.tsx' 'app/(dashboard)/bundlers/bundle-transfer-status.tsx'` — zero errors ✅

---

### Session 53 — SSL Certificate Checker tool

**New tooling page** (`apps/web/app/(dashboard)/certificate-checker/`, `apps/web/app/api/tools/certificate-checker/route.ts`)
- Interactive X.509 cert inspector — no `openssl` needed locally
- Supply the cert three ways on one tab: drag-and-drop a file, click to browse, or paste PEM text directly — PEM drops auto-populate the textarea, binary drops (DER/PKCS#12) are sent as base64
- **Check URL** tab: server-side TLS connect to any host:port with optional SNI override — internal hosts reachable from the web container are inspectable
- **Private key validation** is upfront on both tabs; match result returned in the same API call as parse/fetch
- Download the leaf cert in PEM, DER, or PKCS#7
- Supports PEM, DER, PKCS#7 (`.p7b`), PKCS#12 (`.pfx`/`.p12` with password) input formats
- Full detail rendering: subject/issuer DN, validity, SHA-1/256/512 fingerprints, key algo/size/curve, all extensions (KU, EKU, SANs, policies, basic constraints, AKI/SKI), OCSP/CRL/CA-issuer URLs, chain table, raw PEM with copy
- `node-forge` added for PKCS#7/PKCS#12 parsing; new `tabs.tsx` shadcn primitive from Radix
- Docs: new `apps/docs/docs/features/certificate-checker.md` (updated for paste + drag-drop + inline key validation)
- PRs: carrtech-dev/ct-ops#252 (initial tool), #257 (paste + drag-drop)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 52 — Repo rename + agent enrolment URL env var plumbing

**Repo/image rename** — the repository moved to `carrtech-dev/ct-ops`, so container images now publish to `ghcr.io/carrtech-dev/ct-ops/*`
- Updated hardcoded references in `docker-compose.single.yml`, `.env.example`, customer-bundle README, and `apps/docs/docs/deployment/docker-compose.md`
- PR: carrtech-dev/ct-ops#253

**Enrolment URL env var** (`apps/web/app/(dashboard)/settings/agents/`, `apps/web/.env.example`, `docker-compose.single.yml`)
- Agent enrolment `curl` install command was showing `localhost` when the UI was reached via port-forward/proxy
- New `getAppOrigin()` helper initially backed by `NEXT_PUBLIC_APP_URL`, then unified onto the existing `AGENT_DOWNLOAD_BASE_URL` env var so one variable drives both the ingest service and the web UI's install command
- `AGENT_DOWNLOAD_BASE_URL` also propagated to the web service in `docker-compose.single.yml` (previously only wired to ingest, so `process.env` was undefined in the Next.js server component)
- Falls back to `window.location.origin` when unset, preserving zero-config local dev
- PRs: carrtech-dev/ct-ops#254, #258

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 51 — Host registration deduplication (hostname / IP overlap)

**Ingest-side dedup** (`apps/ingest/internal/handlers/register.go`, `apps/ingest/internal/db/queries/hosts.sql.go`, `agent/internal/registration/registrar.go`)
- Two live hosts in the same org cannot share a hostname or IP — guard now runs at `Register` and at `approveAgent`
- **Online or revoked match** → reject with `ALREADY_EXISTS` so the admin deletes the stale record first
- **Offline / unknown match** → adopt the existing `agents`/`hosts` rows, rotate the new public key onto the existing agent, and preserve approval state — covers reinstall-with-wiped-data-dir cases that previously produced a duplicate "Offline" record
- Agents now report non-loopback IPs in `PlatformInfo` at register time so the server can run the overlap check
- Key rotation appended to agent status history with reason `"adopted re-registration (keypair rotated; matched by hostname or IP)"` for audit
- `apps/web/lib/actions/agents.ts` also hardened against approving a pending agent that now collides with a live host

**Docs**
- `apps/docs/docs/architecture/ingest.md` + `apps/docs/docs/features/hosts.md` — new Duplicate-Host Protection section

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./...` — zero errors ✅

---

### Session 50 — Offline agent install bundle (zip download)

**New download route** (`apps/web/app/api/agent/bundle/route.ts`, `apps/web/lib/agent/bundle.ts`, `apps/web/lib/agent/binary.ts`)
- **Settings → Agent Enrolment → Download Install Bundle** — produces a per-OS/arch zip containing the agent binary, install helper (`install.sh` on Linux/macOS, `install.ps1` on Windows), pre-populated `agent.toml`, `SHA256SUMS`, and a `README.md`
- Three token options: generate a fresh single-use token (default 7-day expiry), embed an existing active token, or ship without a token (operator exports `CT_OPS_ORG_TOKEN` before install)
- Gated to `super_admin` / `org_admin`; scoped by `organisationId`; single-use tokens persisted via `agent_enrolment_tokens` with `metadata.source = 'install-bundle'` and `metadata.os` / `metadata.arch` for audit
- Shared binary resolver extracted to `apps/web/lib/agent/binary.ts` so the new route reuses the download route's cache / GitHub-release / baked-binary fallback
- Zip built with `jszip`
- Closes carrtech-dev/ct-ops#244; PR #250

**Docs**
- New `apps/docs/docs/getting-started/agent-install-bundle.md` (full install walk-through, token audit-trail, troubleshooting)
- Cross-links added to `apps/docs/docs/deployment/air-gap.md`, `apps/docs/docs/architecture/agent.md`, and top-level `README.md` so the bundle is discoverable as the air-gap enrolment path

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 49 — Terminal panel SSR hydration fix

**Root cause** (`apps/web/components/terminal/terminal-panel-context.tsx`)
- `useState` initialiser was reading `sessionStorage` on the client, producing HTML that differed from the server render whenever the terminal panel had persisted tabs
- Resulting React #418 hydration mismatch aborted hydration for the entire dashboard tree, leaving client components (notably the directory-lookup typeahead) non-interactive

**Fix**
- Start with `DEFAULT_STATE` on server and client; load persisted state in a post-mount effect gated by a `hasHydrated` flag so the initial empty state doesn't wipe `sessionStorage`
- `set-state-in-effect` lint rule disabled around the one-shot hydration effect with a comment explaining the canonical pattern
- PRs: carrtech-dev/ct-ops#243, #246

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 48 — Directory User Lookup (live LDAP/AD query)

**New tooling page** (`apps/web/app/(dashboard)/directory-lookup/`, `apps/web/lib/actions/ldap-lookup.ts`)
- **Tooling → Directory User Lookup** — on-demand queries against any configured LDAP/AD server; nothing is synced or stored
- Username typeahead (debounced, prefix-matched via `{{username}}*` on the configured `userSearchFilter`), directory picker when multiple configs exist
- Selecting a user fetches the full attribute set (including operational attrs via `+`) and renders:
  - Summary: display name, username, lock/active status, email, sAMAccountName, UPN, copyable DN
  - Password: expires, last changed, lock status — parses both AD (`msDS-UserPasswordExpiryTimeComputed`, `accountExpires`, `pwdLastSet`, `lockoutTime`, `userAccountControl`) and OpenLDAP/shadow (`shadowLastChange`, `shadowMax`, `pwdChangedTime`, `pwdAccountLockedTime`)
  - Groups: full `memberOf` list with CN + DN, copy button, and client-side filter visible whenever the user has any groups
  - All LDAP Attributes: searchable table of every returned attribute, with Windows file-time / LDAP generalized-time values rendered as human-readable dates and the raw value shown below; binary values as `[binary NB]`; password-hash attributes excluded for safety
- Removed unused sync scaffolding from `ldap_configurations` (`lastSyncAt`, `syncIntervalMinutes`, etc.) and LDAP-sourced columns from `domain_accounts` (`ldapConfigurationId`, `distinguishedName`, `groups`) — the Service Accounts register is now manual-only; live queries go through this tool
- Any authenticated org user can run a lookup; managing LDAP configs remains `org_admin` / `super_admin`

**Follow-up fixes during the same afternoon**
- **Server-action error surfacing** — `searchLdapDirectory` / `lookupDirectoryUser` wrapped in try/catch/finally so a stale client bundle (e.g. after a deploy) no longer leaves the typeahead silently stuck on the spinner; users see a "please reload" message (PR #242)
- **Portal the suggestions dropdown** — the Card ancestor's `overflow-hidden` clipped the absolutely-positioned dropdown; now rendered via `createPortal` on `document.body` with the input's `getBoundingClientRect` tracked on resize/scroll (PR #247)
- **Group filter always visible + humanised LDAP timestamps** — filter shows whenever there is any group (was >5); attribute table humanises Windows file-time / LDAP generalized-time (PR #249)

**Docs**
- New `apps/docs/docs/features/directory-lookup.md` (+ sidebar)
- `apps/docs/docs/features/service-accounts.md` updated to direct live lookups to the new tool
- Earlier in the same day, `apps/docs/docs/features/networks.md` gained a Graph View section covering the Table/Graph toggle, dashed-bezier edges, dark-mode, and the right-click host-node context menu shipped in Session 45; CLAUDE.md's stale Docusaurus reference replaced with the VuePress path (PR #239)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 47 — Terminal text size settings

**Terminal preferences** (`apps/web/components/terminal/`)
- New `terminal-preferences.ts` stores a global default text size in `localStorage` with a live change-event bus so every open pane reacts without a reload
- Settings gear in the terminal panel toolbar opens a popover with a default text-size slider and presets
- Right-click a terminal tab to pick a per-tab text-size override or revert to the default
- `terminal-session.tsx` subscribes to preference changes and resizes xterm live
- Docs updated at `apps/docs/docs/features/terminal.md`
- Branch: `feat/terminal-font-size` (commit `11635d4`)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 46 — Terminal tabs, colours, reorder, and split panes

**Terminal panel overhaul** (`apps/web/components/terminal/`)
- Right-click a tab for rename, colour presets, split right / split down, or close
- Tabs are draggable for reorder
- New `terminal-pane-tree.tsx` — each tab holds a recursive pane tree so a single host session can be split into multiple independent shells with draggable dividers
- `terminal-panel-context.tsx` extended with tab colours, rename, reorder, and split operations
- `terminal-session.tsx` updated for multi-pane rendering per tab
- Docs updated at `apps/docs/docs/features/terminal.md`
- PR: carrtech-dev/ct-ops#234

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 45 — Network topology graph visualizations

**Network graphs** (`apps/web/app/(dashboard)/hosts/networks/`)
- Table/Graph toggle on both individual network page and all-networks page
- Individual network: network node with hosts in a grid below, smoothstep edges
- All-networks: networks in a row, hosts below in columns, cross-network hosts shown once with multiple edges
- New `listNetworksWithHosts` server action for efficient single-query join, lazy-loaded only when graph view is active
- `NetworkNodeComponent` and `HostNodeComponent` (memo-wrapped) with status dots and CIDR badges
- Uses `@xyflow/react` (MIT) for pan/zoom/minimap/controls
- PR: carrtech-dev/ct-ops#220

**Edge animation & dark-mode polish** (`apps/web/app/(dashboard)/hosts/networks/components/`)
- Custom `AnimatedFlowEdge`: `getBezierPath` curves with slow `stroke-dashoffset` CSS animation (10s cycle) — subtle, React-Flow-homepage style
- Endpoint dots at source/target handles; strokes use `var(--muted-foreground)` for light/dark
- React Flow Controls and MiniMap restyled via `globals.css` to use `--card`, `--border`, `--muted`, `--background` theme variables
- Earlier iteration with SVG `animateMotion` moving dots replaced for being too busy
- PRs: carrtech-dev/ct-ops#221 (animated), #224 (dashed bezier)

**Host-node context menu** (`apps/web/app/(dashboard)/hosts/networks/components/`)
- Right-click a host node to open in-app terminal session (with username prompt) or navigate to host detail
- `HostNodeContextMenu` — custom fixed-position overlay fired from React Flow's `onNodeContextMenu` (shadcn ContextMenu didn't work because React Flow intercepts contextmenu at the pane level)
- `HostNodeTerminalDialog` lifted to parent graph level so the terminal dialog survives context-menu unmount
- CSS override restoring `pointer-events:all` on `.react-flow__node-hostNode` (xyflow sets `pointer-events:none` when nodes are non-draggable/non-connectable)
- PRs: carrtech-dev/ct-ops#226, #228, #230, #232

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 44 — Networks (CIDR-based auto-assignment)

**Schema & migrations** (`apps/web/lib/db/schema/networks.ts`, migration 0031)
- New `networks` table — named IP subnets with CIDR range, multi-tenant
- New `host_network_memberships` join table with `is_auto_assigned` flag

**Server actions & UI** (`apps/web/lib/actions/networks.ts`, `apps/web/app/(dashboard)/hosts/networks/`)
- Full CRUD and membership management with RBAC (admin/engineer gating)
- Networks list page, network detail page, Networks tab in host detail under Management
- "Networks" nav item added to sidebar under Hosts

**Ingest auto-assignment** (`apps/ingest/internal/`)
- `SyncHostNetworks` matches heartbeat IPs against org network ranges and syncs auto-assignments; stale assignments removed when IPs change
- Called from heartbeat handler on every tick

**Docs**
- New `apps/docs/docs/features/networks.md`
- PR: carrtech-dev/ct-ops#218

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./...` — zero errors ✅

---

### Session 43 — VuePress documentation site (replacing Docusaurus)

**Migration to VuePress 2** (`apps/docs/`)
- Full migration from Docusaurus v3 to VuePress 2 — smaller, faster, simpler config
- New `apps/docs/docs/.vuepress/config.ts`, custom palette and index SCSS
- Full-text body search enabled (air-gap compatible)
- Dockerfile updated for VuePress build → nginx serve
- GitHub Actions workflow updated; Pages deployment source switched to GitHub Actions workflow
- pnpm version pinned in deploy-docs workflow to match `packageManager` field
- System architecture diagram reworked (image replacing hand-drawn diagram), fixed aspect ratio
- PRs: carrtech-dev/ct-ops#213 (pnpm pin), #217 (VuePress migration), #216 (diagram fix)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 42 — Docusaurus documentation site

**Documentation site** (`apps/docs/`)
- New `apps/docs/` workspace: Docusaurus v3 with dark mode, indigo theme, VS Dark code blocks, full-text local search (`@easyops-cn/docusaurus-search-local`, air-gap compatible)
- 15 documentation pages covering all features, architecture, and deployment profiles
- Sidebar structure in `apps/docs/sidebars.ts`; "Edit this page" GitHub links on every page
- Dockerfile for local development: Node build → nginx serve
- GitHub Actions workflow (`.github/workflows/deploy-docs.yml`) auto-deploys to GitHub Pages on push to `main`
- `Documentation Rules` section added to `CLAUDE.md` — docs must be updated in the same PR as any feature change
- webpack pinned to 5.99.0 in workspace overrides for Docusaurus compatibility
- pnpm version pinned to 10.6.5 in CI workflow to match `packageManager` field

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- PR: carrtech-dev/ct-ops#212 (`feat/docusaurus-docs-site`)

---

### Session 41 — Software report enhancements (unified table, charts, export)

**Software report** (`apps/web/app/(dashboard)/reports/software/software-report-client.tsx`)
- **Unified table**: all software search results combined into a single sortable table (was separate sections per version) — PR carrtech-dev/ct-ops#202
- **Clickable hostnames**: clicking a host in the results opens its detail page — PR carrtech-dev/ct-ops#204
- **First-seen column**: added to results table to show when a package was first observed — PR carrtech-dev/ct-ops#206
- **OS distribution chart**: pie/bar breakdown of hosts by OS type per package — PR carrtech-dev/ct-ops#206
- **Version breakdown chart**: for the selected package shows distribution of installed versions — PR carrtech-dev/ct-ops#206
- **Dark mode chart labels**: axis and legend labels now visible in dark mode — PR carrtech-dev/ct-ops#208
- **Export rate limiting**: sliding window 3-per-10-seconds limit; export errors now shown in a modal dialog — PR carrtech-dev/ct-ops#210
- **CSV/PDF export fixes**: correct parameter passing for filters; export respects OS family and version filters — PR carrtech-dev/ct-ops#204

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 40 — deleteHost cascade, JWT key persistence, inventory scan reliability

**deleteHost cascade** (`apps/web/lib/actions/agents.ts`)
- Full FK deletion order: notifications → alert_instances → software_scans → task_run_hosts → remaining FKs → host record
- PRs: carrtech-dev/ct-ops#196 (notifications), #198 (all FKs), #200 (software_scans)

**JWT signing key persistence** (`apps/ingest/internal/`)
- Ingest service now persists its JWT signing key in the database (org settings table) on first start
- Survives Docker volume resets — agents no longer get 401s after a volume wipe
- PR: carrtech-dev/ct-ops#194

**Inventory scan reliability** (`apps/ingest/`, `apps/web/`)
- Inventory tab polls for scan completion and shows live status while a scan is running — PR carrtech-dev/ct-ops#187
- Per-collector logging and ingest scan-start diagnostics added — PR carrtech-dev/ct-ops#189
- Failed scan errors surfaced in the host Inventory tab (was silently ignored) — PR carrtech-dev/ct-ops#191
- Ingest accepts expired agent JWTs in the inventory stream handler to prevent scan failures during token rotation — PR carrtech-dev/ct-ops#193

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./...` — zero errors ✅

---

### Session 39 — Software report overhaul and monitoring fixes

**Software report UX overhaul** (`apps/web/app/(dashboard)/reports/software/software-report-client.tsx`)
- Replaced paginated table with per-package detail view: typeahead combobox selects a package; results show all hosts grouped by version with hostname, OS version, source, architecture, last seen
- Exact version filter shows a dropdown of versions from the DB when a specific package is selected
- Source filter replaced with OS type filter (Linux / macOS / Windows) using `hosts.os` field
- `getPackageDetails` and `getPackageVersions` server actions added
- Export route updated to pass `osFamily` filter
- **Inventory wipe bug fixed** — if `collectPackages` returns an error, the task now fails immediately rather than streaming 0 packages; streaming 0 packages caused `MarkRemovedPackages` to wipe the host's entire inventory
- PR: carrtech-dev/ct-ops#185

**Monitoring reliability** (`agent/internal/heartbeat/heartbeat.go`, `apps/ingest/internal/db/queries/alerts.sql.go`, `apps/web/app/(dashboard)/hosts/[id]/alerts-tab.tsx`)
- **CPU spike elimination**: `resultsReady` heartbeats now send a cached `hostMetricsSnapshot` collected on the regular 30s tick rather than re-sampling CPU — prevents near-zero delta windows inflating readings to 100%
- **Alert double-evaluation fix**: `GetAlertRulesForHost` now filters `is_global_default = false` — global defaults (templates) were being evaluated alongside their host-specific clones
- **Global defaults visible**: Alerts tab on host detail shows a read-only "Organisation-wide Default Rules" section linking to Settings → Alerts
- PR: carrtech-dev/ct-ops#183

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./...` — zero errors ✅

---

### Session 38 — Full software inventory feature

**Agent** (`agent/internal/tasks/`)
- New `software_inventory` task handler with cross-platform package collection:
  - Linux: dpkg → rpm → pacman → apk (ordered by availability)
  - macOS: `system_profiler SPApplicationsDataType` + Homebrew
  - Windows: registry walk (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`)
- Snap/Flatpak/Windows Store sources toggleable via org settings
- Streams packages in 500-package chunks via new `SubmitSoftwareInventory` gRPC endpoint
- `task_id` injected into context from `runner.go` so handlers use it as `scan_id`

**Ingest** (`apps/ingest/internal/handlers/`)
- `inventory.go`: JWT-authenticated client-streaming RPC; bulk UNNEST upsert, marks removed rows on `is_last`, completes `task_run_hosts` row
- `software_sweeper.go`: 60s ticker creates `software_inventory` tasks for hosts overdue per org `intervalHours` setting
- `software.sql.go`: bulk UNNEST upsert, removed-package marking, scan tracking queries

**Database** (`apps/web/lib/db/schema/software.ts`, migrations `0028`, `0029`)
- `software_packages` — per-host package rows with name, version, source, architecture, first_seen, last_seen, is_removed
- `software_scans` — per-scan metadata (started_at, completed_at, package_count, status)
- `saved_software_reports` — per-user saved filter presets

**Web** (`apps/web/`)
- **Host Inventory tab** (`hosts/[id]/inventory-tab.tsx`): last scan banner, Rescan button, CSV export, Compare button, stale-scan alert, show-removed toggle, client-side search
- **Host Compare page** (`hosts/[id]/compare/`): side-by-side diff of packages between two hosts
- **Reports → Installed Software** (`reports/software/`): URL-synced filters (name typeahead, version modes, source, host group), new-in-window, package drift, compare two hosts, saved report filters
- **Export route** (`api/reports/software/export/route.ts`): CSV (injection-safe field escaping) + PDF (`@react-pdf/renderer` server-side)
- **Settings card** (`settings/settings-client.tsx`): enable/disable inventory, interval hours, Snap/Flatpak/Windows Store source toggles

**Proto** (`proto/agent/v1/ingest.proto`)
- `SubmitSoftwareInventory` client-streaming RPC added to `IngestService`
- Generated Go bindings updated

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./...` — zero errors ✅
- PRs: carrtech-dev/ct-ops#175 (`feature/software-inventory`), #177, #179, #181

---

### Session 38 — Notification purge hygiene

**Ingest** (`apps/ingest/internal/handlers/notification_purge_sweeper.go`, `apps/ingest/internal/db/queries/notifications.go`)
- New notification purge sweeper starts with ingest, runs immediately, then repeats daily
- Permanently deletes notifications whose `deleted_at` is older than 90 days
- Query is covered by a focused unit test using a fake pgx executor

**Database / docs**
- Added partial `notifications_deleted_at_idx` index for efficient purge scans
- Notification retention docs now describe the fixed 90-day soft-delete purge window

**Build state**
- `go test ./...` from `apps/ingest` — pass
- `pnpm --filter web db:validate` — pass
- `pnpm --filter web type-check` — pass
- `pnpm --filter web lint` — exits 0 with existing warnings outside this change
- `BETTER_AUTH_URL=http://localhost:3000 DATABASE_URL=postgres://postgres:postgres@localhost:5432/ct_ops BETTER_AUTH_SECRET=<32-char-local-build-secret> pnpm --filter web build` — pass, with existing Turbopack trace warning

---

### Session 37 — Remote agent uninstall on host deletion

**Agent** (`agent/internal/tasks/uninstall.go`, `uninstall_unix.go`, `uninstall_windows.go`)
- New `agent_uninstall` task type — agent returns a `scheduled` result then spawns a detached child process to run the existing `-uninstall` flow
- The detached process survives the service manager terminating the original agent
- Linux: uses `systemd-run --no-block --collect` to place the uninstaller in its own transient cgroup (prevents systemd `KillMode=control-group` from killing it when the agent service is stopped); falls back to `setsid` for non-systemd Linux
- macOS: `setsid`-style process detach (launchd tracks by PID, not cgroup)
- Windows: `CREATE_NEW_PROCESS_GROUP` flag

**Web** (`apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx`, `apps/web/lib/actions/agents.ts`)
- Host delete dialog adds "Also uninstall agent from the remote host" checkbox — visible only when the agent is online
- On confirm, dispatches the `agent_uninstall` task before deleting the host record
- `deleteHost` action fixed: `task_run_hosts` rows now cleaned up before deleting the host (latent FK violation)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./agent/...` — zero errors ✅
- PRs: carrtech-dev/ct-ops#171 (`feature/host-delete-uninstall-agent`), #173

---

### Session 36 — Terminal panel viewport fix

**Dashboard layout** (`apps/web/app/(dashboard)/layout.tsx`)
- `SidebarProvider` container changed from `min-h-svh` to `h-svh overflow-hidden` — bounds the entire dashboard to the viewport height
- The main content area already uses `overflow-auto` so page content still scrolls internally; the terminal panel stays pinned at the bottom on all pages regardless of content length
- PR: carrtech-dev/ct-ops#165 (`feature/terminal-fixed-bottom`)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 35 — Notification enhancements: bulk actions, charts, soft-delete, and host metrics integration

**Database** (`apps/web/lib/db/schema/alerts.ts`, migration `0027_ambiguous_manta`)
- `deleted_at` column added to `notifications` table — brings it in line with the project's universal soft-delete convention (was the only major table missing it)

**TypeScript actions** (`apps/web/lib/actions/notifications.ts`)
- `deleteNotification` / `deleteNotifications` — converted from hard delete to soft delete (set `deleted_at`)
- All inbox queries (`getNotifications`, `getUnreadCount`, `markAsRead`, `markAllAsRead`, `markBatchReadStatus`) now filter `WHERE deleted_at IS NULL`
- `deleteNotifications(orgId, userId, ids[])` — new batch soft-delete action
- `markBatchReadStatus(orgId, userId, ids[], read)` — new batch read/unread toggle
- `getNotificationStats(orgId, userId, hostId?)` — counts per severity for pie chart; optional `hostId` scopes to a specific host
- `getNotificationsOverTime(orgId, userId, range, hostId?)` — daily or hourly aggregation for line chart; intentionally omits `deleted_at` filter so deleting from the inbox never affects historical trend data; optional `hostId` scopes to a specific host; enforces 90-day maximum retention window
- `TrendRange` type exported: `'1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d'`

**UI — Notifications page** (`apps/web/app/(dashboard)/notifications/notifications-client.tsx`)
- **Bulk selection**: checkbox on every notification card + select-all checkbox with indeterminate state
- **Bulk action toolbar**: appears when ≥1 item selected — "Mark as read", "Mark as unread", "Delete", "Clear selection"
- **Per-card mark as unread**: expanded card now shows "Mark as unread" for already-read notifications (was read-only before)
- **Severity breakdown pie chart** (donut): critical / warning / info distribution with percentage tooltips; updates on query refetch; "No data" placeholder when empty
- **Notification trend line chart**: critical & warning daily/hourly counts with a time-range dropdown; description subtitle updates dynamically; `fill: currentColor` + parent `text-muted-foreground` wrapper fixes SVG axis label visibility in dark mode
- **Time-range dropdown** on trend chart: 1h · 6h · 12h · 24h · 7d · 30d · 3 months; sub-24h ranges aggregate per hour (HH:mm labels), longer ranges per day (MMM d labels); TanStack Query key includes range so switching triggers a fresh fetch
- Selection is cleared on filter tab change and pagination

**UI — Host detail / Metrics tab** (`apps/web/app/(dashboard)/hosts/[id]/host-notification-charts.tsx`, `host-detail-client.tsx`)
- New `HostNotificationCharts` component renders both charts below the Heartbeat Interval chart on the Monitoring → Metrics tab
- Charts are scoped to the specific host via the `hostId` filter on both server actions
- Same time-range dropdown and dark-mode-safe axis labels as the global notifications page
- "No notifications for this host" / "No data for this period" placeholders shown when empty

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- PRs: carrtech-dev/ct-ops#159, #161, #163, #165

---

### Session 34 — Slack, Telegram, and in-app notification channels

**Database** (`apps/web/lib/db/schema/alerts.ts`, `auth.ts`, `organisations.ts`, migration `0026_youthful_anthem`)
- `notifications` table: per-user rows with subject, body, severity, resourceType, resourceId, read flag, alertInstanceId FK
- `notificationsEnabled` column added to `user` table (default true)
- `OrgNotificationSettings` added to `OrgMetadata` JSONB: `inAppEnabled`, `inAppRoles`, `allowUserOptOut`
- `NotificationChannelType` expanded to `'webhook' | 'smtp' | 'slack' | 'telegram'`
- `SlackChannelConfig { webhookUrl }` and `TelegramChannelConfig { botToken; chatId }` interfaces added

**Go ingest service** (`apps/ingest/internal/`)
- `alerts.sql.go`: `GetEnabledSlackChannels`, `GetEnabledTelegramChannels`, `GetOrgNotificationSettings`, `GetAlertTargetUsers` (role + opt-out filter), `InsertNotificationBatch` (pgx.Batch)
- `notify.go`: `postSlack` (Block Kit JSON), `dispatchSlack`, `postTelegram` (Bot API HTML mode), `dispatchTelegram`, `dispatchInApp` (org settings → user targeting → batch insert)
- `alerts.go`: `notifChannels` struct expanded; all evaluators (`check_status`, `metric_threshold`, `cert_expiry`) call Slack + Telegram + in-app dispatch on fire and resolve

**TypeScript actions** (`apps/web/lib/actions/`)
- `alerts.ts`: Zod discriminated union extended for Slack/Telegram; `NotificationChannelSafe` union updated (Telegram masks botToken as `hasBotToken`); `updateNotificationChannel` and `sendTestNotification` handle all four types
- `notifications.ts`: `getNotifications`, `getUnreadCount`, `markAsRead`, `markAllAsRead`, `deleteNotification`
- `notification-settings.ts`: `getOrgNotificationSettings` (with defaults), `updateOrgNotificationSettings` (admin-only, Zod-validated)
- `profile.ts`: `updateNotificationPreference` (respects org `allowUserOptOut`)

**UI — Alerts page** (`apps/web/app/(dashboard)/alerts/alerts-client.tsx`)
- `AddSlackDialog`, `EditSlackDialog`, `AddTelegramDialog`, `EditTelegramDialog` components following existing dialog pattern
- "Add Slack" and "Add Telegram" buttons in channels card header
- Type badges (MessageSquare for Slack, Send for Telegram); details column shows webhookUrl/chatId

**UI — Notification bell** (`apps/web/components/shared/notification-bell.tsx`, `topbar.tsx`)
- Topbar Bell icon with absolute-positioned red badge showing unread count (capped at 99+)
- Dropdown: 10 most recent notifications with severity dot, bold subject (unread), relative timestamp, blue dot indicator
- Click: `markAsRead` + navigate to resource (`/hosts/{id}` or `/certificates/{id}`)
- Footer: "View all notifications" → `/notifications`
- Polls every 20 s via TanStack Query `refetchInterval`

**UI — Notifications page** (`apps/web/app/(dashboard)/notifications/`)
- Server component fetches initial 25 notifications + unread count for SSR
- Filter tabs: All / Unread (with badge)
- Cards: severity dot, subject, severity badge, relative + absolute timestamps; click to expand body + resource link + mark-read + delete
- "Mark all read" header button; Previous/Next pagination (PAGE_SIZE=25)
- Polls every 30 s

**UI — Settings** (`apps/web/app/(dashboard)/settings/settings-client.tsx`)
- "Notification Settings" card: Enable in-app toggle, role checkboxes (super_admin/org_admin/engineer/read_only), Allow user opt-out toggle; admin-only

**UI — Profile** (`apps/web/app/(dashboard)/profile/profile-client.tsx`)
- "Notifications" card: toggle visible when org `inAppEnabled`; disabled with explanatory text when org disallows opt-out

**Sidebar** (`apps/web/components/shared/sidebar.tsx`)
- "Notifications" entry added to Monitoring group (BellPlus icon, `/notifications`)

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./...` — zero errors ✅
- PR: carrtech-dev/ct-ops#155

---

### Session 33 — Terminal UX polish: saved username and reconnect on exit

**Username memory** (`apps/web/components/terminal/host-terminal-launcher.tsx`, `terminal-session.tsx`, `host-selector-dialog.tsx`)
- Last-used terminal username per host per user saved to `localStorage` (`terminal-username-{hostId}-{userId}`)
- Pre-fills the username input on subsequent connections to the same host
- Uses `useMemo` (not `useEffect`) to read saved value — avoids unnecessary re-renders

**Reconnect on exit** (`apps/web/components/terminal/terminal-session.tsx`)
- When a terminal session ends (e.g. typing `exit`), displays a "Press any key to reconnect" prompt
- Reconnects with the same host and username on keypress instead of leaving a dead terminal

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 32 — Terminal tab persistence across browser refresh

**Session storage persistence** (`apps/web/components/terminal/terminal-panel-context.tsx`)
- Open terminal tabs (host ID, hostname, username, panel height, active tab index) saved to `sessionStorage` on every state change
- On page load, restores tabs with fresh session IDs — triggers automatic reconnection to the same hosts
- Correctly scoped to browser tab (`sessionStorage` not `localStorage`) — tabs don't survive closing the browser tab, which is correct since PTY sessions are dead at that point

**Provider scope fix** (`apps/web/app/(dashboard)/layout.tsx`)
- `TerminalPanelProvider` moved above the sidebar component so the terminal trigger button in the sidebar nav has provider context

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 31 — Terminal redesign: persistent bottom panel with tabs

**Panel architecture** (`apps/web/components/terminal/`)
- New `terminal-panel.tsx` — VS Code-style resizable bottom panel visible on all dashboard pages
- `terminal-panel-context.tsx` — React context managing tab state (add/remove/switch tabs), panel visibility and height
- `terminal-layout-wrapper.tsx` — wraps page content and renders the panel below
- `terminal-session.tsx` — individual xterm.js session component, one per tab
- `host-selector-dialog.tsx` — searchable host picker with username input, accessible from sidebar nav and host detail page
- Old `terminal-tab.tsx` removed from host detail page — replaced by the global panel

**Sidebar integration** (`apps/web/components/shared/sidebar.tsx`)
- "Terminal" entry added under Tooling section in the sidebar nav
- Opens the host selector dialog; selected host opens as a new tab in the persistent panel

**Host detail launcher** (`apps/web/app/(dashboard)/hosts/[id]/host-terminal-launcher.tsx`)
- "Open Terminal" button on host detail page opens a tab in the global panel for that specific host

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 30 — Per-user terminal authentication and cross-distro shell support

**Per-user authentication** (`apps/web/lib/db/schema/terminal-sessions.ts`, `agent/internal/terminal/session.go`)
- New `username` column on `terminal_sessions` table — migration `0025_luxuriant_smasher.sql`
- Agent launches PTY via `su -l <username>` with dropped privileges (not `login`, which varies across distros)
- Organisation-level "Direct Access" toggle (`terminalDirectAccess` in org metadata) allows bypassing username requirement
- UI shows username input on terminal tab; direct access mode skips it

**Shell environment hardening** (`agent/internal/terminal/session.go`)
- Agent sets `TERM=xterm-256color`, `HOME`, and prefers `bash` over default shell for PTY sessions
- Cross-distro compatibility: tested with Ubuntu, AlmaLinux, CentOS patterns

**Auth fallback** (`apps/ingest/`)
- Falls back to `session_id` auth when agent JWT signature verification fails (handles key rotation gracefully)
- Accepts expired agent JWTs for Terminal gRPC streams — terminal sessions shouldn't break during token rotation windows

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./agent/... ./apps/ingest/...` — zero errors ✅

---

### Session 29 — WebSocket terminal: initial implementation and agent connection debugging

**Terminal protocol** (`proto/agent/v1/terminal.proto`, `proto/agent/v1/heartbeat.proto`)
- New `TerminalSession` message: session ID, host ID, status, input/output/resize frames
- `HeartbeatResponse` gains `pending_terminal_sessions` field — ingest pushes pending sessions to agent on every heartbeat
- New `TerminalStream` RPC on ingest service for bidirectional terminal I/O

**Database schema** (`apps/web/lib/db/schema/terminal-sessions.ts`, migration `0024_flat_blade.sql`)
- `terminal_sessions` table: session ID, host ID, user ID, org ID, status (pending/connected/disconnected/failed), timestamps

**Ingest: session routing** (`apps/ingest/`)
- Pending terminal sessions included in every heartbeat response so agent picks them up
- Terminal data streamed over existing gRPC connection — no additional ports required
- Diagnostic messages added during development: session state tracking, push counters, agent status reverse-lookup

**Agent: PTY management** (`agent/internal/terminal/`)
- `session.go` — opens PTY, reads/writes terminal frames, handles resize events
- Integrated with heartbeat response handler — agent starts terminal session when it receives a pending session

**Web: terminal UI** (`apps/web/app/(dashboard)/hosts/[id]/terminal-tab.tsx`)
- xterm.js terminal embedded in host detail page tab
- WebSocket connection from browser → Next.js API route → ingest gRPC stream
- Container shown during "connecting" state to avoid 0x0 dimension bug with xterm

**Organisation settings** (`apps/web/app/(dashboard)/settings/settings-client.tsx`)
- Terminal enable/disable toggle and port configuration in org settings

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./agent/... ./apps/ingest/...` — zero errors ✅

---

### Session 28 — Chart zoom, smart bucketing, custom scripts, and service management

**Metrics chart improvements** (`apps/web/components/charts/`, `apps/web/hooks/use-chart-zoom.ts`)
- Extracted Recharts into reusable `HostMetricsLineChart` and `HostHeartbeatBarChart` components under `components/charts/`
- `useChartZoom` hook: click-drag zoom on any chart, reset button to restore original range
- Adaptive `time_bucket` sizing: capped at 300 data points regardless of time range — prevents chart overload on 30d views
- New 6h and 30d time range presets

**Custom script runner** (`agent/internal/tasks/script.go`, `apps/web/lib/actions/task-runs.ts`)
- New `custom_script` task type: agent receives script content, writes to temp file, executes with streaming output
- `triggerCustomScriptRun` / `triggerGroupCustomScriptRun` server actions
- Script input dialog on host detail and group detail pages with multiline editor
- Task monitor page shows script content in results panel

**Service management** (`agent/internal/tasks/service.go`, `apps/web/lib/actions/task-runs.ts`)
- New `service_action` task type: start / stop / restart / status operations on systemd services
- `triggerServiceAction` / `triggerGroupServiceAction` server actions
- Service action dialog with autocomplete: "Query server" button fetches running services from the host via `list_services` agent query, shows clickable dropdown
- Task monitor page shows service-specific result formatting

**Interactive terminal on host detail** (`apps/web/app/(dashboard)/hosts/[id]/terminal-tab.tsx`)
- Terminal tab on host detail page: each command creates a `custom_script` task run, output streams at 1.5s poll intervals
- Up/down arrow command history recall, Ctrl+C cancels running command, Clear button wipes session

**Task history management** (`apps/web/app/(dashboard)/hosts/[id]/tasks-tab.tsx`, `apps/web/lib/actions/task-runs.ts`)
- Checkbox selection on task history tables (host and group views)
- Select-all header checkbox, bulk Delete button
- Soft-deletes selected `task_run` and `task_run_hosts` rows

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./agent/... ./apps/ingest/...` — zero errors ✅

---

### Session 27 — Dark mode with per-user theme preference

**User-persisted theme** (`apps/web/lib/db/schema/auth.ts`, `apps/web/lib/actions/profile.ts`)
- New `theme` column (`'light' | 'dark' | 'system'`, default `'system'`) on the `users` table — migration `0023_high_loki.sql`
- `updateTheme(userId, theme)` server action: validates with Zod, writes to DB, and sets a 1-year `theme` cookie (path `/`, sameSite `lax`, not httpOnly) so subsequent SSR reads work without an extra DB query

**Root layout: SSR dark class + FOUC prevention** (`apps/web/app/layout.tsx`)
- Root layout is now `async`; reads the `theme` cookie server-side via `cookies()` and adds the `dark` class to `<html>` when `theme === 'dark'`
- Injects a tiny inline `<script>` in `<head>` that runs before React hydrates: reads the cookie, and for `system` or missing values uses `window.matchMedia('(prefers-color-scheme: dark)')` — prevents any flash of wrong theme for returning users and handles OS dark preference on first load

**Profile page Appearance card** (`apps/web/app/(dashboard)/profile/profile-client.tsx`)
- New "Appearance" card below the 2FA section with three buttons: Light / Dark / System (Sun / Moon / Monitor icons)
- Selected option highlighted with `border-primary bg-primary/10`; on click: applies class to `document.documentElement` immediately (no reload), then saves to DB and sets cookie via `updateTheme` mutation in the background
- Current theme initialised from `user.theme` so the correct button is pre-selected

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- Migration `0023_high_loki.sql` generated and applied ✅

---

### Session 26 — General agent task framework with Linux host patching

**Database schema** (`apps/web/lib/db/schema/tasks.ts`, migrations `0021`–`0022`)
- `task_runs` table: type, status, config jsonb, `max_parallel`, org/created-by FKs, started/completed timestamps
- `task_run_hosts` table: per-host execution state (pending → running → completed/failed/cancelled/skipped), `raw_output` text accumulator, exit_code, reboot_required, packages_updated jsonb
- `max_parallel` enforced at query level — SQL counts active rows before dispatching so concurrent ingest instances cannot over-dispatch

**Protocol additions** (`proto/agent/v1/heartbeat.proto`)
- `AgentTask` (server→agent): task_run_host_id, task_type, config_json
- `AgentTaskProgress` (agent→server): incremental stdout/stderr chunk per heartbeat cycle
- `AgentTaskResult` (agent→server): final status, exit code, reboot flag, packages list
- `HeartbeatResponse` gains `cancel_task_ids` (field 10) for agent-side cancellation signals

**Ingest: task dispatch and output streaming** (`apps/ingest/internal/handlers/heartbeat.go`)
- 2-second ticker polls `GetPendingTasksForHost` respecting `max_parallel`; pushes `AgentTask` messages in each `HeartbeatResponse`
- Appends output chunks with `raw_output || chunk` on every `AgentTaskProgress` message
- Marks `task_run_hosts` terminal on `AgentTaskResult`; closes parent `task_runs` when all hosts reach a terminal state
- `GetCancellingTasksForHost` pushes `cancel_task_ids` so the agent can kill in-flight processes
- `TimeoutStuckTaskRunHosts` marks `running` hosts as failed after 60 minutes; fires every 5 minutes from the heartbeat handler

**Agent: task runner** (`agent/internal/tasks/`)
- `runner.go` — registry pattern: `RegisterHandler(taskType, HandlerFunc)`; routes by `task_type`, stores per-task `context.CancelFunc` in a `sync.Map`; cancellation via `handleResponse` on `cancel_task_ids` arrival
- `patch.go` — first registered handler; detects package manager (`apt` / `dnf` / `yum` / `zypper`), supports `all` and `security` modes, streams real output via `io.Pipe`, checks `/var/run/reboot-required` and `needs-restarting`, parses updated package list from output
- 45-minute context timeout per task; `RunPatch` returns `"cancelled by user"` or `"task timed out"` for distinct error messages
- `io.Pipe` deadlock fixed: scanner goroutine reads from the pipe while the command writes; `pw.Close()` deferred after `cmd.Wait()`

**Web: task monitoring UI** (`apps/web/app/(dashboard)/tasks/[id]/`, `apps/web/app/(dashboard)/hosts/[id]/tasks-tab.tsx`)
- `/tasks/[id]` monitor page: host list (left column) with pending/running/done status icons, scrolling terminal-style output panel (right), live elapsed timer in panel header, auto-scroll while task is running, 3-second poll stops when task completes
- Amber warning after 5 minutes with no output, noting the 60-minute auto-fail
- Host detail "Tasks" tab: "Run Patch" button (Linux hosts only), patch mode dialog (All / Security), task history table with links to monitor page
- Group detail "Patch Group" button: mode selection + parallel host selector (1 / 2 / 5 / 10 / Unlimited), non-Linux skip warning, task history
- "Cancel" button on monitor page sets host to `cancelling` state; ingest sends `cancel_task_ids` to agent on next heartbeat

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./agent/... ./apps/ingest/...` — zero errors ✅

---

### Session 25 — Host groups with collapsible sidebar navigation

**Database schema** (`apps/web/lib/db/schema/host-groups.ts`, migration `0021_chilly_tomas.sql`)
- `host_groups` table: name, description, org FK, standard timestamps
- `host_group_members` table: group FK, host FK, agent FK, org FK — join table with audit timestamps

**Server actions** (`apps/web/lib/actions/host-groups.ts`)
- `createHostGroup`, `updateHostGroup`, `deleteHostGroup` — full CRUD, Zod-validated, org-scoped
- `getHostGroups(orgId)` — returns groups with member count
- `getHostGroup(orgId, groupId)` — returns group + full member list
- `addHostToGroup`, `removeHostFromGroup` — membership management

**Groups UI** (`apps/web/app/(dashboard)/hosts/groups/`)
- `/hosts/groups` list page: create dialog, edit inline, delete with confirmation, member count badge
- `/hosts/groups/[id]` detail page: group metadata header, member list table with remove button, "Add Host" dialog with search/filter over org hosts not already in the group
- Host detail page "Groups" tab: shows current group memberships with inline add and remove

**Sidebar restructure** (`apps/web/components/shared/sidebar.tsx`)
- Collapsible parent/child navigation: Hosts → All Hosts + Groups; Settings → Organisation + Agent Enrolment + Alert Defaults + LDAP + System Health
- `CollapsibleSidebarItem` component with chevron indicator; auto-expands when a child route is active
- Added shadcn `textarea` and `form` UI components

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- Migration `0021_chilly_tomas.sql` generated and applied ✅

---

### Session 24 — LDAP UI polish and enrollment token improvements

**LDAP TLS certificate preview** (`apps/web/app/(dashboard)/settings/ldap/`)
- Fixed TLS certificate textarea overflowing the modal width across three iterations: added `break-all` word-wrap, then capped at 5 visible lines with vertical scroll (`max-h-20 overflow-y-auto`)

**Agent enrollment token list** (`apps/web/app/(dashboard)/settings/agents/`)
- Added copy-to-clipboard actions for token value and install command on each row
- Replaced dual copy icons with a single "View" button opening a modal showing the full token and ready-to-run `curl` install command in a code block

**Development tooling** (`start.sh`)
- Replaced `dev.sh` with a unified `start.sh` supporting both production Docker mode and local development
- Single entry point reduces onboarding friction

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 23 — Agent lifecycle: uninstall, auto re-register, and stream reliability

**Agent -uninstall flag** (`agent/internal/install/uninstall.go`, `agent/cmd/agent/main.go`)
- New `-uninstall` CLI flag: stops the running service, removes the binary, service files, config, and data directories
- Cross-platform: systemd (Linux), launchd (macOS), Windows SCM

**Agent auto re-registration after host deletion** (`agent/internal/heartbeat/heartbeat.go`, `apps/web/lib/actions/hosts.ts`)
- Agent detects gRPC `NotFound` / `PermissionDenied` / `Unauthenticated` on heartbeat stream and returns `ErrAgentDeregistered` rather than retrying indefinitely
- `runAgent` outer loop: on `ErrAgentDeregistered`, clears `agent_state.json` and re-registers with the same keypair — host reappears in the UI automatically without reinstall
- `deleteHost` server action now also deletes `agent_status_history` and the `agent` record so the running agent is rejected on its next heartbeat

**Ingest heartbeat stream close** (`apps/ingest/internal/handlers/heartbeat.go`)
- Heartbeat streaming goroutine now closes within 30 seconds when the associated agent is deleted, preventing orphaned open streams from keeping the host falsely "online"

**Build state**
- `go build ./agent/... ./apps/ingest/...` — zero errors ✅
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 22 — LDAP post-login flows and migration reliability

**LDAP post-login flows** (`apps/web/app/(setup)/setup-email/`, `apps/web/app/(setup)/pending-approval/`)
- LDAP users provisioned with placeholder `@ldap.local` email are redirected to `/setup-email` to capture a real address before accessing the dashboard
- New LDAP users are provisioned with `role: 'pending'` and redirected to `/pending-approval`; an admin assigns a role from the Team page to grant access
- Session cookie signing fixed to match Better Auth's HMAC format; LDAP search base resolution improved

**Migration timestamp validation** (`apps/web/scripts/validate-migrations.js`, `package.json`)
- `db:generate` script now runs `validate-migrations.js` after `drizzle-kit generate`: verifies all journal entries have strictly increasing `when` timestamps and fails with a clear error if not
- Prevents the silent "already applied" skip that burned us in Session 13
- ESLint config updated to ignore the validator script

**LDAP edit dialog with TLS certificate upload** (`apps/web/app/(dashboard)/settings/ldap/`)
- Pencil icon on each LDAP config row opens a pre-filled edit dialog
- TLS certificate field accepts paste or file upload; stored in the `ldap_configurations.tls_certificate` column
- `updateLdapConfiguration` server action validates and persists changes

**Build state**
- `pnpm run build` — zero TypeScript errors ✅

---

### Session 21 — Phase 4: LDAP directory integration and service account restructure

**Service account / directory account split** (`apps/web/app/(dashboard)/service-accounts/`, `apps/web/app/(dashboard)/hosts/[id]/`)
- Local OS users moved from top-level service accounts page to per-host "Users" and "Settings" tabs; these are host-scoped, not org-level inventory
- New "Service Accounts" top-level page targets network/domain accounts sourced from LDAP/AD
- Per-host "Settings" tab: collection toggles (CPU, Memory, Disk on by default; Local Users opt-in); org-level defaults applied to newly enrolled hosts

**LDAP / Active Directory integration** (`apps/web/lib/ldap/client.ts`, `apps/web/app/api/auth/ldap/route.ts`, `apps/web/app/(dashboard)/settings/ldap/`)
- `ldap_configurations` table: host, port, bind DN/password (AES-256-GCM encrypted at rest using `LDAP_ENCRYPTION_KEY`), base DN, user/group filters, TLS mode — migration `0016`
- `domain_accounts` table: synced directory accounts with last-seen, locked, password-age, group memberships — migration `0016`
- LDAP client (`ldapts`): `testConnection`, `syncUsers`, `authenticateUser` functions
- `POST /api/auth/ldap` route: authenticates domain credentials, upserts Better Auth user + session; dual-mode login form (email/password tab + domain username/password tab)
- Settings → LDAP page: create config, test connection, trigger sync, view synced user count

**Agent check delivery resilience** (`agent/internal/heartbeat/heartbeat.go`, `agent/internal/checks/executor.go`)
- `hostID` resolution failures (pre-approval agent) no longer crash the stream; check results are buffered and retried on the next heartbeat
- Check executor survives stream reconnects: goroutines are kept alive; pending results accumulate and drain on the next successful stream

**Build state**
- `pnpm run build` — zero TypeScript errors ✅
- `go build ./agent/... ./apps/ingest/...` — zero errors ✅
- Migrations `0014`–`0017` generated and applied ✅

---

### Session 18 — Overview dashboard and System Health separation

**Problem: operational data was on the wrong page**
- Certificates and Active Alerts were displayed on the System Health page (`/settings/system`), which is an admin view for CT-Ops's own platform internals. The Overview page (`/dashboard`) was an empty placeholder.
- Engineers had to navigate into Settings to see whether alerts were firing or certificates were expiring — the wrong mental model.

**Fix: split data by audience**
- **System Health** now shows only CT-Ops platform internals: version, licence tier, database connection status, metric retention, and agent pipeline counts. Description updated to "Platform status and configuration".
- **Overview** now shows the operational state of infrastructure: Agents (online/offline), Certificates (valid/expiring/expired), Active Alerts (firing/acknowledged), and a Summary panel. All cards link through to their respective detail pages.

**New `/api/overview` endpoint** (`apps/web/app/api/overview/route.ts`)
- Returns `agents`, `certificates`, and `alerts` counts scoped to the user's organisation.
- `/api/system/health` stripped of certificate and alert queries — now only queries agents and org config.

**New `DashboardClient` component** (`apps/web/app/(dashboard)/dashboard/dashboard-client.tsx`)
- Polls `/api/overview` every 30 seconds (matching System Health behaviour).
- Overview `page.tsx` delegates to this client component, replacing the static placeholder.

**Build state**
- `pnpm run build` (apps/web) — zero TypeScript errors ✅
- `/api/overview` route appears in build output ✅

---

### Session 17 — Certificate page production bug fixes

**Problem 1: `Failed to find Server Action` on certificates list and detail pages**
- Root cause: `getCertificates`, `getCertificateCounts`, and `getCertificate` were all called from TanStack Query `queryFn` inside client components. Server actions use POST and are identified by a build-time hash; in production standalone Docker builds, client and server bundles can have drifted action IDs across deployments, causing Next.js to reject the requests.
- Fix (list page): added `GET /api/certificates` and `GET /api/certificates/counts` route handlers (`apps/web/app/api/certificates/route.ts`, `apps/web/app/api/certificates/counts/route.ts`). `CertificatesClient` `queryFn` now uses `fetch()` against these routes. Added `initialData` and `staleTime: 30s` so SSR data is used on first render without an immediate refetch.
- Fix (detail page): removed `useQuery` from `CertificateDetailClient` entirely — the server page already SSR-fetches the certificate and passes it as props, so no client-side refetch was needed.
- `deleteCertificate` mutation continues to use the server action (correct pattern — mutations are the intended use case for server actions).

**Problem 2: `RangeError: Invalid time value` crash on certificate chain table**
- Root cause: `CertificateChainEntry` TypeScript interface in `apps/web/lib/db/schema/certificates.ts` declared fields as camelCase (`notAfter`, `notBefore`, `fingerprintSha256`) but the Go ingest handler serialises `certChainEntry` with snake_case JSON tags (`not_after`, `not_before`, `fingerprint_sha256`). Every read of `entry.notAfter` in the chain table returned `undefined` → `new Date(undefined)` → Invalid Date → `date-fns format()` threw `RangeError: Invalid time value` during SSR, crashing the detail page.
- Fix: corrected `CertificateChainEntry` to use snake_case keys matching the Go JSON output; updated the chain table in `certificate-detail-client.tsx` to use `entry.not_after` and `entry.fingerprint_sha256`.

**Other fixes on this branch (not yet merged to main at session start)**
- `fix(ci)`: tracked `agent-dist` directory so Docker `COPY` succeeds in CI (`288291d`)
- `feat(checks)`: added `cert_file` check type to Add Check dialog and fixed cert JSON display (`9ad2882`)
- `fix(ci)`: bumped ingest Dockerfile to `golang:1.25-alpine` (`3c5ef71`)
- `fix(web)`: fixed EACCES on `agent-dist` volume mount by switching to root entrypoint with `su-exec` privilege drop (`909494d`)

**Build state**
- `pnpm run build` (apps/web) — zero TypeScript errors ✅
- `GET /api/certificates` and `GET /api/certificates/counts` routes appear in build output ✅

---

### Session 16 — Phase 3 Certificate Management

**Database schema** (`apps/web/lib/db/schema/certificates.ts`, migration `0013_certificates.sql`)
- New `certificates` table with composite unique index on `(org_id, host, port, server_name, fingerprint_sha256)`, expiry and status indexes, soft delete, `source` column (`discovered|imported|issued`) for future CA work, `discoveredByHostId` field (semantically scoped to discovery, not deployment)
- New `certificate_events` table for append-only event spine: discovered, renewed, expiring_soon, expired, restored, removed
- `CertificateStatus`, `CertificateSource`, `CertificateEventType` TypeScript types

**Web: check type extension** (`apps/web/lib/db/schema/checks.ts`, `apps/web/lib/actions/checks.ts`)
- Added `'certificate'` to `CheckType` union and `CertificateCheckConfig` to `CheckConfig`
- Zod schema in `createCheck` / `updateCheck` accepts the new type

**Web: server actions** (`apps/web/lib/actions/certificates.ts`, `apps/web/lib/certificates/expiry.ts`)
- `getCertificates(orgId, filters)` — paginated, filterable by status/host, sortable
- `getCertificate(orgId, certId)` — returns cert + events
- `getCertificateCounts(orgId)` — valid/expiring_soon/expired/invalid tallies
- `deleteCertificate(orgId, certId)` — soft delete
- `computeExpiryStatus(notAfter, warnDays)` and `formatDaysUntil(date)` helpers

**Web: UI** (`apps/web/app/(dashboard)/certificates/`, `apps/web/components/certificates/`)
- `CertificatesClient` — summary cards, host filter, status/sort selects, sortable table defaulting to soonest-expiry-first
- `/certificates/[id]` detail page — summary cards, fingerprint copy, SANs chips, chain table, event timeline
- `CertificateStatusBadge` — valid/expiring_soon/expired/invalid with correct color coding
- Replaced placeholder page.tsx

**Web: alert rule extension** (`apps/web/lib/db/schema/alerts.ts`, `apps/web/lib/actions/alerts.ts`, `apps/web/app/(dashboard)/hosts/[id]/alerts-tab.tsx`)
- `CertExpiryConfig` interface and `'cert_expiry'` added to `AlertConditionType` and `AlertRuleConfig`
- Zod `certExpiryConfigSchema` added to create/update schemas
- `AddRuleDialog` extended: scope radio (All / Specific), cert picker, days-before-expiry input; `ruleConditionSummary` handles cert_expiry display

**Agent: certificate check** (`agent/internal/checks/certificate.go`, `agent/internal/checks/executor.go`)
- `runCertificateCheck(cfg)` — dials with TLS skip (intentional, own validation), parses leaf + chain, builds `CertificateReport` JSON
- Returns `pass` (valid), `fail` (expired/not-yet-valid), or `error` (dial failure)
- Dispatcher wired in executor.go

**Ingest: certificate persistence** (`apps/ingest/internal/handlers/certificates.go`, `apps/ingest/internal/db/queries/certificates.sql.go`)
- `persistCertificateResult` — unmarshals report, computes status, upserts via natural key, detects renewal (new fingerprint for same endpoint emits `renewed` event on both old and new rows), writes discovered/status-change events
- Wired into heartbeat handler via per-heartbeat `GetChecksForHost` type map

**Ingest: cert expiry alert evaluator + sweeper** (`apps/ingest/internal/handlers/alerts.go`, `apps/ingest/cmd/ingest/main.go`)
- `evaluateCertExpiryForCert` — called immediately after persist; loads org's cert_expiry rules, evaluates each
- `evaluateCertExpiryRule` — fires/resolves `alert_instances` row keyed by `ruleID + metadata.certificateId`; uses cert's `discovered_by_host_id` as FK-safe `host_id`; dispatches via existing webhook + SMTP pipeline
- `RunCertExpirySweeper` goroutine — ticks every 15 min, sweeps all orgs with cert_expiry rules
- Sweeper started from `main.go`

**Go queries** (`apps/ingest/internal/db/queries/certificates.sql.go`)
- `UpsertCertificate`, `FindCertsForEndpoint`, `InsertCertificateEvent`, `GetActiveCertAlertInstance`, `InsertCertAlertInstance`, `GetCertExpiryRulesForOrg`, `GetAllOrgsWithCertExpiryRules`, `ListCertificatesExpiringWithin`, `GetCertificateByID`

**Build state**
- `pnpm run build` (apps/web) — zero TypeScript errors ✅
- `go build ./apps/ingest/... ./agent/...` — zero errors ✅
- Migration `0013_certificates.sql` generated ✅

---

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
- `go build github.com/carrtech-dev/ct-ops/ingest/...` — compiles ✅
- `go build github.com/carrtech-dev/ct-ops/agent/...` — compiles ✅

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
- Filenames are versioned (`ct-ops-agent-linux-amd64-v0.5.0`); new releases picked up automatically without cache invalidation
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
- Also supports `-address` CLI flag and `CT_OPS_ORG_TOKEN` / `CT_OPS_INGEST_ADDRESS` env vars for config-less operation
- Enrolment token dialog shows the ready-to-run curl command as the primary action

**Multi-platform service install** (`agent/internal/install/install.go`, `agent/cmd/agent/service_windows.go`)
- **Linux:** systemd unit written to `/etc/systemd/system/ct-ops-agent.service`, `systemctl enable --now`
- **macOS:** launchd plist written to `/Library/LaunchDaemons/dev.carrtech.ct-ops.agent.plist`, `launchctl load`
- **Windows:** binary copied to `C:\Program Files\ct-ops\`; service installed via `sc.exe` with proper Stop/Shutdown signal handling

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
- `proto/gen/go/go.mod` — `module github.com/carrtech-dev/ct-ops/proto`

**Go workspace** (`go.work` at repo root)
- References `./proto/gen/go`, `./agent`, `./apps/ingest`
- `replace` directives in each `go.mod` for local proto module

**Go agent** (`agent/`)
- `internal/config/` — TOML config + `CT_OPS_` env overrides
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

- `codec.go` is a development stub ✅ Resolved — real protoc-generated `.pb.go` files are in place
- `newCUID()` in ingest DB queries now uses `crypto/rand` ✅
- Docker Compose does not auto-run migrations on startup ✅ Resolved — `entrypoint.sh` runs `node migrate.js && node server.js` before starting the web server
- `gen_cuid()` SQL function does not exist in PostgreSQL ✅ Resolved — `InsertAgent` now generates the ID in Go via `newCUID()` directly, removing the failed-query fallback path
- mTLS client certificates deferred — TLS builder is structured for it; deliberately deferred
- The `go.work.sum` file is gitignored — developers must run `go work sync` after cloning
- CPU % on first heartbeat is always 0 — by design (two-sample baseline); accurate from second heartbeat onward
- Metric retention `add_retention_policy` not wired dynamically ✅ Resolved — `updateMetricRetention` server action already calls `drop_retention_policy` + `add_retention_policy` via `db.execute(sql\`...\`)`
- Soft-deleted notifications accumulate indefinitely ✅ Resolved — ingest now hard-purges notifications soft-deleted for more than 90 days

---

## Blockers

_None._

---

## What The Next Session Should Build

**Session 39 — Phase 4 Service Accounts & Identity**

Notification data hygiene is complete. Suggested next steps:

1. **Phase 4: Service Accounts & Identity** — schema (`service_accounts` table with name, type, owner, expiry); list UI with expiry countdown badges; soft delete
2. **SSH key inventory** — track SSH public keys linked to service accounts; fingerprint, last-used-at, expiry
3. **Expiry tracking + alerting** — new alert condition type `service_account_expiry`; ingest evaluator + sweeper (mirrors cert_expiry pattern)
4. **LDAP/AD integration** — community-tier LDAP sync; imports users and service accounts from directory

**Outstanding technical debt (carry forward):**
- mTLS client certificates deferred — TLS builder is structured for it
- `go.work.sum` is gitignored — developers must run `go work sync` after cloning

---

## Phase Completion Checklist

### Phase 0 — Foundation
- [x] Monorepo scaffold (Turborepo)
- [x] Next.js app with shadcn/ui + Tailwind
- [x] PostgreSQL + Drizzle + migrations pipeline
- [x] Docker Compose single-node
- [x] CI pipeline (GitHub Actions) — pr-checks.yml: lint, type-check, build, go test
- [x] Better Auth — email/password + TOTP
- [x] Organisation + user schema
- [x] Basic RBAC (roles + permissions)
- [x] User management UI
- [x] Feature flag system
- [x] Licence key validation scaffold
- [x] Auth middleware (route protection)
- [x] System health / about page — /settings/system with live agent/cert/alert counts

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
- [x] Notification channels (webhook HMAC-SHA256, SMTP, Slack, Telegram, in-app)
- [x] In-app notification bell, dropdown, and /notifications page
- [x] Org notification settings (roles, opt-out) + per-user opt-out
- [x] Notification bulk actions (select-all, bulk mark read/unread, bulk delete)
- [x] Notification severity pie chart + trend line chart on /notifications page
- [x] Notification charts on host detail Metrics tab (host-scoped)
- [x] Soft-delete on notifications (preserves trend history through deletions)
- [x] Hard-purge soft-deleted notifications after 90 days
- [x] Trend chart time-range selector (1h → 3 months, hourly/daily auto-granularity)
- [x] Alert silencing
- [x] Alert acknowledgement
- [x] Alert history pagination + date/severity filter

### Phase 3 — Certificate Management
- [x] Agent-side cert discovery — `certificate` check type in agent; returns structured CertificateReport JSON
- [x] Certificate parser — leaf + chain parsing in agent; upsert with renewal detection in ingest
- [x] Certificate inventory UI — /certificates list + /certificates/[id] detail with SANs, chain, event timeline
- [x] Expiry alerting — `cert_expiry` alert condition; per-cert evaluator + 15-min sweeper in ingest
- [ ] CSR generation wizard
- [ ] Approval workflow
- [ ] Internal CA management

### Phase 4 — Service Accounts & Identity
- [ ] Service account inventory
- [ ] Expiry tracking + alerting
- [ ] SSH key inventory
- [ ] LDAP/AD integration

### Phase 5 — Infrastructure Tooling
- [x] Custom script runner — run arbitrary scripts on hosts/groups with streaming output
- [x] Service management — start/stop/restart/status with live service autocomplete
- [x] Interactive terminal — WebSocket PTY terminal with persistent panel, tabs, per-user auth
- [x] Chart zoom and smart bucketing — click-drag zoom, adaptive time_bucket, reusable chart components
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
