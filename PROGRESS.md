# PROGRESS.md — Infrawatch Build State
> This file is updated at the END of every Claude Code session.
> It is the source of truth for what exists, what works, and what comes next.
> Read this at the START of every session before doing anything.

---

## Current Phase
**Phase 1 — Agent & Host Inventory**

## Current Status
🟡 Phase 1 in progress — Go agent + proto + gRPC ingest service built; registration flow + host UI complete. mTLS, Redpanda, metrics consumer, and check definitions deferred.

---

## What Has Been Built

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
- `newCUID()` in ingest DB queries uses `math/rand` — replace with a proper cuid2 Go library
- `readCPUPercent()` in agent heartbeat always returns 0 — requires two-sample measurement to be accurate
- No database migration has been run for the new schema tables (agents, hosts, resource_tags, agent_enrolment_tokens, agent_status_history) — run `pnpm db:generate && pnpm db:migrate` in `apps/web`
- Docker Compose does not auto-run migrations on startup
- `gen_cuid()` SQL function does not exist in PostgreSQL — `InsertAgent` has a fallback but the primary query will fail and fall through. The fallback is correct.
- mTLS client certificates deferred — TLS builder is structured for it; add in next agent session
- The `go.work.sum` file is gitignored — developers must run `go work sync` after cloning

---

## Blockers

_None._

---

## What The Next Session Should Build

**Session 4 — Database migration, integration smoke test, mTLS, agent config example**

1. Run `pnpm db:generate && pnpm db:migrate` and verify schema lands correctly
2. Generate dev TLS: `make dev-tls`
3. `docker compose -f docker-compose.single.yml up`
4. Create enrolment token in UI
5. Configure and run `./dist/agent` — verify pending agent appears
6. Approve in UI — verify agent becomes active and heartbeats
7. Add mTLS client cert verification to ingest TLS builder
8. Add agent example config file: `agent/examples/agent.toml`
9. Fix `newCUID()` in ingest queries to use a real cuid2 equivalent
10. Fix CPU percent collection (two-sample measurement)

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
- [ ] Agent self-update mechanism (deferred)
- [ ] Redpanda integration (deferred)
- [ ] Metrics consumer (deferred)
- [ ] Real-time status indicators
- [ ] Integration smoke test (end-to-end agent → UI)

### Phase 2 — Monitoring & Alerting
- [ ] Check definition system
- [ ] Check types (shell/port/process/http/file)
- [ ] TimescaleDB continuous aggregates
- [ ] Metric retention policies
- [ ] Metric graphs (Recharts)
- [ ] Alert rule builder
- [ ] Alert state machine
- [ ] Notification channels (email/webhook/Slack)
- [ ] Alert silencing + acknowledgement
- [ ] Alert history

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
