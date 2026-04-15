# CLAUDE.md — Infrawatch (working title)
> This file is the permanent reference for architecture, conventions, and decisions.
> Never modify this file during a development session unless correcting a factual error.
> All project decisions are recorded here so any session can start with full context.

---

## Project Overview

Infrawatch is an open-source infrastructure monitoring and tooling platform aimed at corporate engineering teams and individuals. It is designed to run in air-gapped environments with no external dependencies.

Core capabilities (in roadmap order):
- Agent-based server monitoring (Go agent, gRPC)
- Certificate lifecycle management
- Service account and identity tracking
- Infrastructure tooling (air-gap bundlers, runbooks)
- Alerting and notification routing
- Enterprise features (SSO, audit log, compliance packs)

---

## Naming

The product working title is **Infrawatch**. All code, variables, and references should use this. It will be renamed before public release — a single grep/replace should handle it. Do not bikeshed the name during development sessions.

---

## Licence Strategy

- Core platform: **Apache 2.0**
- Agent: **Apache 2.0** (must always be open — security teams audit agents)
- Enterprise features: **Proprietary** (source-available, compiled in via feature flag)
- Enterprise code lives in `apps/web/enterprise/` — clearly separated

---

## Monorepo Structure

```
infrawatch/
├── apps/
│   ├── web/                          # Next.js application (primary)
│   └── ingest/                       # Go gRPC ingest service
├── agent/                            # Go agent binary (Apache 2.0)
├── consumers/                        # Go queue consumers
│   ├── metrics/
│   ├── alerts/
│   └── events/
├── proto/                            # Canonical protobuf definitions
│   └── agent/v1/
├── packages/
│   └── proto-ts/                     # Generated TypeScript types from proto
├── deploy/
│   ├── docker-compose.single.yml
│   ├── docker-compose.standard.yml
│   ├── docker-compose.ha.yml
│   ├── helm/
│   └── scripts/
├── docs/
├── CLAUDE.md                         # This file
├── PROGRESS.md                       # Current build state (updated each session)
└── TASK.md                           # Current session task (overwritten each session)
```

---

## Web Application Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) | |
| Language | TypeScript (strict) | No `any` — ever |
| UI Components | shadcn/ui | Copy-owned, Radix primitives |
| Styling | Tailwind CSS | shadcn conventions |
| Data fetching (read) | TanStack Query + Server Actions | |
| Data fetching (write) | TanStack Query useMutation + Server Actions | |
| ORM | Drizzle ORM | |
| Database | PostgreSQL + TimescaleDB | |
| Auth | Better Auth | |
| Charts | Recharts | Wrapped in components/charts/ |
| Forms | React Hook Form + Zod | |
| Queue client | Abstracted — see Queue section | |

---

## TypeScript Conventions

```typescript
// ALWAYS infer types from Drizzle schema — never write types manually for DB entities
export type Host = typeof hosts.$inferSelect
export type NewHost = typeof hosts.$inferInsert

// NEVER use `any`
// Use `unknown` and narrow, or define proper types

// Server Actions must be explicitly typed
export async function getHosts(orgId: string): Promise<Host[]> {}

// All server actions live in apps/web/lib/actions/
// Named by domain: hosts.ts, certificates.ts, alerts.ts etc.
```

---

## Data Fetching Pattern

```typescript
// Reading data — TanStack Query calling a Server Action
const { data, isLoading } = useQuery({
  queryKey: ['hosts', orgId],
  queryFn: () => getHosts(orgId),
})

// Writing data — TanStack Query mutation calling a Server Action
const { mutate } = useMutation({
  mutationFn: (data: NewHost) => createHost(data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hosts'] }),
})
```

---

## Database Conventions

### Schema files
All schema lives in `apps/web/lib/db/schema/`
One file per domain: `hosts.ts`, `certificates.ts`, `alerts.ts` etc.
All exported from `apps/web/lib/db/schema/index.ts`

### Universal table conventions
Every table MUST have:
```typescript
id: text('id').primaryKey().$defaultFn(() => createId()),  // cuid2
organisationId: text('organisation_id').notNull().references(() => organisations.id),
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
deletedAt: timestamp('deleted_at', { withTimezone: true }),  // soft delete
metadata: jsonb('metadata'),                                  // escape hatch
```

### Tags
Tags are `key:value` strings. Any resource can be tagged.
Tag relationships live in a join table: `resource_tags(resource_id, resource_type, key, value)`
Never add bespoke category columns — use tags.

### Status fields
Resources with state use both a current status column AND a status history table.
Never overwrite status — append to history.

### Foundational patterns (always respect these)
1. **Multi-tenancy** — every resource row has `organisation_id`
2. **Soft deletes** — `deleted_at` on every table, never hard delete
3. **Tags as first-class** — flexible `key:value` tagging on any resource
4. **Event spine** — significant state changes append to the `events` table
5. **Status as state machine** — current status + history table
6. **JSONB escape hatch** — `metadata jsonb` on every major table

---

## Authentication & Authorisation

**Library:** Better Auth

**Auth methods (tiered):**
```
Community (always available, air-gapped safe)
├── Email + password
├── TOTP MFA
└── API keys (agents, integrations)

Enterprise (licence required)
├── SAML 2.0
├── OIDC
└── LDAP / Active Directory (also available in community for corporate adoption)
```

Note: LDAP/AD is in the community tier — paywalling it would block corporate adoption.

**RBAC Roles:**
```
super_admin   Full system access, billing, global config
org_admin     User/team management, integrations, org config
engineer      Read/write on assigned resource groups, alert management
read_only     View dashboards, alerts, inventory (management, auditors)
agent         Non-human, register host + submit metrics only
```

**Resource scoping:**
Resources are scoped via tags. A user's effective access is:
`role permissions` + `resource group membership` (tag-based)

**Licence gating:**
```typescript
// Feature flags derive from licence tier
const features = {
  sso:            licence.tier >= 'pro',
  auditLog:       licence.tier >= 'pro',
  advancedRbac:   licence.tier >= 'pro',
  whiteLabel:     licence.tier === 'enterprise',
  compliancePack: licence.tier === 'enterprise',
}
```

Licence validation is **offline-capable** — signed JWT validated against bundled public key. No phone-home.

---

## Agent Architecture

- Written in **Go** — single binary, no runtime dependencies
- Communicates via **gRPC + mTLS** over port 443 (configurable)
- Push model — agent initiates connection to ingest service
- Falls back to HTTPS polling if gRPC/HTTP2 is blocked

**Agent capabilities (fixed — new features are check definitions, not agent code):**
```
shell     Run a script, return stdout/stderr/exit code
file      Read/hash/stat a file
port      TCP/UDP connectivity check
process   Check if a process is running
http      Internal HTTP health check
metric    Collect system metrics (CPU/mem/disk/net)
```

**Agent identity model:**
1. First run generates a keypair on the host
2. Agent registers with ingest service, enters pending state
3. Admin approves agent in UI (or auto-approve if configured)
4. Server issues signed JWT bound to agent's public key
5. mTLS for all subsequent communication
6. Tokens rotate automatically

**Self-update:**
- Agent polls server for minimum required version
- Downloads signed binary from server (not internet)
- Verifies signature, hot-swaps, rolls back on failure
- Works fully air-gapped — server is the update source

---

## Ingest & Queue Architecture

```
Agent → gRPC → Ingest Service → Redpanda → Consumers → PostgreSQL
```

**Queue abstraction:**
The queue interface is abstracted. Implementation is swapped via config:
```
small   (<50 hosts)   In-process (Go channels + WAL)
standard              Redpanda single node
ha                    Redpanda cluster
```

**Redpanda topics:**
```
metrics.raw
events.raw
alerts.pending
agent.status
```

**Consumers** (separate Go binaries, independently scalable):
```
consumers/metrics/    Writes metric data to TimescaleDB
consumers/alerts/     Evaluates alert rules, writes alert instances
consumers/events/     Writes to events spine, triggers webhooks
```

---

## Deployment Profiles

```yaml
# Three profiles — same codebase, different scale
single    PostgreSQL + in-process queue + single ingest + Next.js
standard  PostgreSQL + Redpanda + single ingest + Next.js
ha        PostgreSQL primary/replica + Redpanda cluster +
          multiple ingest + multiple Next.js + HAProxy
```

**Air-gap support:**
- All images bundleable as a tarball: `docker save | gzip > infrawatch.tar.gz`
- `deploy/scripts/airgap-bundle.sh` produces the offline installer
- No CDN dependencies — all assets served locally
- Agent updates served from the infrawatch server, not the internet

---

## Component Conventions (Next.js / React)

```
apps/web/components/
├── ui/           shadcn primitives (DO NOT modify — re-run shadcn CLI to update)
├── charts/       Recharts wrappers — always wrap, never use Recharts directly in pages
├── hosts/        Domain components
├── certificates/
├── alerts/
└── shared/       Cross-domain components (PageHeader, DataTable, StatusBadge etc.)
```

**Page structure:**
```typescript
// app/(dashboard)/hosts/page.tsx
// - Server component for initial data / metadata
// - Delegates to a client component for interactivity
// - Never put TanStack Query hooks in server components
```

**shadcn/ui message pattern:**
Use `message.useMessage()` hook — never call message methods directly.
Include `contextHolder` in component JSX.

---

## Development Roadmap Phases

```
Phase 0 — Foundation        Monorepo, Next.js, auth, orgs, Docker Compose
Phase 1 — Agent & Inventory Agents, hosts, basic metrics, gRPC, ingest
Phase 2 — Monitoring        Checks, alerting, graphs, TimescaleDB
Phase 3 — Certificates      Discovery, expiry alerts, CSR workflows
Phase 4 — Service Accounts  Identity, SSH keys, LDAP sync
Phase 5 — Tooling           Air-gap bundlers, runbooks, scheduled tasks
Phase 6 — Enterprise        SSO, audit log, advanced RBAC, compliance packs
Phase 7 — Cloud SaaS        Multi-tenant hardening, billing, hosted offering
```

Each phase must be **independently deployable and useful** before the next begins.
Do not start Phase N+1 until Phase N is solid.

---

## Database Migration Rules

> **CRITICAL — do not skip these steps.**

### Always use `db:generate` for schema changes

**Never hand-write migration SQL files or `_journal.json` entries manually.**

When you change any file in `apps/web/lib/db/schema/`:

```bash
cd apps/web
pnpm run db:generate   # creates the SQL file + updates meta/_journal.json
pnpm run db:migrate    # applies it to the local/dev database
```

**Why this matters:** `drizzle-kit generate` produces a consistent SQL file, a correctly-hashed journal entry, and a meta snapshot that all three consumers (drizzle-kit CLI, the ORM migrator in `migrate.js`, and the Docker container startup) agree on. Hand-crafted migrations have been proven to cause the migration to be recorded in `__drizzle_migrations` as applied without the SQL actually executing — leaving the database out of sync with no error and no way to re-run the migration without manual intervention.

### Migration checklist
1. Edit schema file(s) in `apps/web/lib/db/schema/`
2. Run `pnpm run db:generate` — commit the generated files alongside the schema change
3. Run `pnpm run db:migrate` to apply locally
4. Run `pnpm run build` to verify no TypeScript errors

---

## Documentation Rules

The public documentation site lives in `apps/docs/docs/`. It is hosted on GitHub Pages and auto-deployed on push to `main`.

**Rule: update the docs in the same branch/PR as any feature change.**

- Adding a new feature → create or update the relevant page in `apps/docs/docs/features/`
- Changing how an existing feature works → update the affected page
- Adding a new deployment option or config variable → update the relevant page in `apps/docs/docs/deployment/` or `apps/docs/docs/getting-started/`
- Architecture changes → update `apps/docs/docs/architecture/`

Do not wait until "later" to update the docs. If you implement a feature without updating the docs, the docs are wrong.

The `apps/docs/docs/` directory structure mirrors the sidebar in `apps/docs/sidebars.ts`. If you add a new page, also add it to `sidebars.ts`.

---

## Code Quality Rules

- TypeScript strict mode — no `any`, no `@ts-ignore` without explanation
- No linting errors — fix before committing
- Run `pnpm run build` after every significant change and fix all errors
- Server Actions must validate input with Zod before touching the database
- All database queries must be scoped by `organisationId`
- Never expose internal IDs in URLs without verifying the requesting user has access
- All mutations must be wrapped in try/catch with meaningful error messages

---

## What We Are NOT Doing (to avoid scope creep)

- Not building a full APM (no distributed tracing, no flame graphs)
- Not replacing Kubernetes operators or Helm
- Not building a secrets manager (integrate with Vault/external, don't replace)
- Not building a ticketing system (integrate with Jira/Linear, don't replace)
- Not requiring internet access for any core feature
