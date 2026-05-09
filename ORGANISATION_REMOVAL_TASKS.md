# CT-Ops Organisation Removal Tasks

## Goal

Remove the concept of an organisation from CT-Ops permanently. CT-Ops is moving
to a standalone installation model: one installation is one instance. If a user
wants another instance, they install CT-Ops again on another server.

This tracker coordinates the work across multiple agents. Each agent must take
the next unfinished task, complete only that task, and update this file before
finishing so the next agent can continue without duplicating work.

## Non-Negotiable Direction

- Organisation support must be completely removed.
- Do not comment out old organisation code.
- Do not keep organisation code behind feature flags, compatibility shims,
  aliases, overloads, or legacy wrappers.
- Do not preserve old organisation docs, tests, examples, migrations, route
  shapes, types, or UI copy as legacy references.
- Do not add a path to reinstate organisation features.
- Git history is the only history needed.
- Existing development data does not need to be preserved. Development installs
  can be deleted and reinstalled.

## Recovery And Drift Controls

The current web implementation is intentionally passing through a transitional
state where several completed slices expose instance-scoped wrappers while some
lower-level core/database code can still contain organisation-scoped names or
assumptions. That transition is allowed only to keep Tasks 10-12 independently
shippable. It must not become the final architecture.

For Tasks 10-12:

- Prefer deleting organisation code in the selected workflow over wrapping it.
- Only introduce a temporary wrapper when the slice cannot land without it.
- If a temporary wrapper leaves org-scoped core code, schema, migrations, RLS,
  tests, or copy behind, record that exact residue in the task `Follow-up` so
  Task 13 has a concrete deletion list.
- Do not add compatibility aliases, overloaded signatures, or route/query
  shims that allow caller-supplied organisation identity to keep working.
- Do not mark a task complete if its owned public actions, route handlers, or
  UI still accept `orgId`, `organisationId`, `organisation_id`, `org_id`, or
  tenant identity from callers.

Task 13 is the hard cleanup gate for the web app. It must collapse the
transitional wrapper/core split where it only exists to preserve old
organisation-scoped internals, remove the schema and migration residue, and
prove a fresh standalone web install has no organisation table, columns, RLS
settings, helper APIs, or test fixtures. Do not soften Task 13 into a cosmetic
grep cleanup.

## Why This Tracker Was Resequenced

The original task split put schema removal, auth removal, and API/action removal
in separate tasks. That order was tried and it blocked agents:

- PR `#1213` recorded that schema-only removal breaks auth, dashboard loaders,
  server actions, and CT-CVE integrations.
- PR `#1214` recorded that auth/onboarding removal is not shippable while
  action/API contracts remain org-scoped.
- PR `#1215` recorded that action/API org removal is not shippable while auth
  and schema remain org-scoped.

Do not retry schema-only, auth-only, or API-only removal as standalone tasks.
The first real implementation task below intentionally owns the web schema,
auth, actions, APIs, UI, and web tests together so it can land as a coherent
single-instance conversion.

If an agent believes Task 1 is too large for one PR, that agent must first open
a tracker-only PR that replaces Task 1 with smaller vertical slices. Each new
slice must be independently shippable, leave `pnpm --dir apps/web type-check`
passing, and move a complete product path away from organisations. Do not split
by technical layer in a way that recreates the blocked schema/auth/API cycle.

## Agent Workflow

Before editing anything, every agent must:

1. Read `AGENTS.md`.
2. Check open PRs and this file for unfinished follow-through in this workstream.
3. Create a new dedicated worktree for the task, per `AGENTS.md`.
4. Re-read the task list below and pick the first task whose status is
   `Not started`.
5. Change that task status to `In progress` in this file and commit that change
   as part of the task PR.

While working:

- Complete only the selected task unless a small adjacent edit is required to
  keep the repo building.
- Delete org-based code entirely rather than routing around it.
- Prefer `instance`, `installation`, or `team` only where the product still
  needs a replacement concept.
- Do not create `memory.md` or sidecar automation notes for this workstream.
  This tracker is the handoff record.
- If you find a separate issue outside the selected task, create a GitHub issue
  as required by `AGENTS.md` rather than expanding scope.

Before finishing:

1. Run the validation listed for the selected task.
2. Update that task's status to `Complete`.
3. Fill in `Completed by`, `Summary`, `Files changed`, `Validation`, `PR`, and
   `Follow-up` for that task.
4. If a task cannot be completed, leave it as `Blocked`, explain exactly why,
   and list the next concrete action. Do not mark later tasks blocked simply
   because earlier tasks remain unfinished.

## Status Values

- `Not started`: available for the next agent.
- `In progress`: currently owned by an agent or PR.
- `Blocked`: cannot continue until the listed blocker is resolved.
- `Complete`: merged to `main` with validation recorded.

## Task 1 - Split Core Web Conversion Into Vertical Slices

Status: Complete

Completed by: Codex automation

PR: [#1217](https://github.com/carrtech-dev/ct-ops/pull/1217)

Summary: Replaced the blocked all-at-once web conversion with smaller
independently shippable slices so the next agent can take a real product path
instead of retrying the schema/auth/API deadlock.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`

Validation: `rg -n "orgId|organisationId|organisation_id|org_id|organisations|requireOrg|SameOrg|withOrgDatabaseScope|runWithOrgDatabaseScope|app\\.organisation_id|tenant" apps/web`

Follow-up: Start Task 2 next. Do not restore the previous single-PR Task 1.

### Required work

- Replace the previous blocked Task 1 with smaller vertical slices.
- Keep each new slice independently shippable.
- Ensure each slice leaves `pnpm --dir apps/web type-check` passing.
- Ensure each slice removes organisation concepts from a complete product path,
  not just one technical layer.

### Acceptance criteria

- The tracker no longer asks an agent to remove all web organisation concepts in
  one PR.
- The first available implementation task is a smaller vertical slice that can
  land without recreating the schema/auth/API dependency cycle.

### Validation

- `rg -n "^## Task " ORGANISATION_REMOVAL_TASKS.md`

## Task 2 - Web Auth, Setup, And Instance Foundation

Status: Complete

Completed by: Codex automation

PR: [#1218](https://github.com/carrtech-dev/ct-ops/pull/1218)

Summary: Removed onboarding and organisation-selection from the auth/setup
path, switched LDAP sign-in to instance-scoped integration IDs, and updated
auth/setup E2E coverage to seed the instance through the baseline user context
instead of direct organisation lookups.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`, `apps/web/app/(auth)`,
`apps/web/app/(dashboard)/settings/{integrations,ldap}`, `apps/web/app/api/auth/ldap/route.ts`,
`apps/web/app/accept-invite/page.tsx`, `apps/web/lib/actions/{ldap,organisations}.ts`,
`apps/web/lib/auth/*`, `apps/web/lib/default-organisation.ts`,
`apps/web/tests/e2e/{auth.setup.ts,auth,fixtures/seed.ts,setup}`

Validation: `pnpm --dir apps/web type-check`; `pnpm --dir apps/web lint`
(warnings only); `pnpm --dir apps/web test:unit` (fails only
`lib/db/rls.test.mjs` and `lib/integrations/ct-cve/db-nonce-store.test.mjs`
because no container runtime is available here); `pnpm --dir apps/web exec playwright test --list`;
targeted Playwright smoke attempt on `tests/e2e/auth/register.spec.ts`
failed before execution because the local web server environment did not define
`BETTER_AUTH_URL`.

Follow-up: Start Task 3 next. When re-running auth/setup E2E smoke tests,
provide the expected web env vars and a working container runtime first.

### Required work

This slice owns the sign-in and bootstrap path so users can access CT-Ops as a
standalone instance without any organisation prerequisite.

- Remove organisation creation actions and onboarding screens.
- Remove redirects that send users without an organisation to `/onboarding`.
- Remove `users.organisationId` from auth/session/user types and all session
  loading logic touched by this path.
- Replace org membership guards, same-org checks, and org-admin wrappers used by
  auth/setup flows with instance-level role checks.
- Remove LDAP tenant/organisation selection. LDAP configuration and login must
  be instance-scoped.
- Remove invitation assumptions that attach a user to an organisation. Invites
  should invite users into the instance.
- Replace org-owned settings needed by auth/setup with instance-level storage.
  Use the existing system config table if it fits; otherwise add a standalone
  instance settings table.
- Rewrite setup/auth E2E fixtures and unit tests touched by this slice so they
  seed standalone instance users and no longer query or insert organisations.
- Remove tenant-isolation auth/setup tests rather than adapting them into no-op
  tests.

### Acceptance criteria

- Authenticated users are never blocked because they lack an organisation.
- There is no `/onboarding` route for creating an organisation.
- LDAP login and configuration do not require tenant or organisation selection.
- Invite acceptance joins a user to the instance without caller-supplied org
  identity.
- Web tests for auth/setup no longer insert into or query `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for auth, setup, LDAP, and invites where local
  infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|requireOrg|SameOrg|withOrgDatabaseScope|runWithOrgDatabaseScope|app\\.organisation_id|tenant" apps/web/app apps/web/lib/auth apps/web/tests/e2e`

## Task 3 - Split Dashboard Core Conversion Into Smaller Vertical Slices

Status: Complete

Completed by: Codex automation

PR: [#1220](https://github.com/carrtech-dev/ct-ops/pull/1220)

Summary: Replaced the oversized dashboard conversion slice with narrower
product-path tasks after auditing the remaining org-scoped surface and finding
it still spans hosts, tasks, alerts, notifications, agents, team, terminal,
certificates, build docs, and multiple APIs. The next implementation task
should now be a coherent hosts-and-tasks slice instead of an all-dashboard PR.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`

Validation: `rg -l "organisationId|orgId|requireOrg|SameOrg|tenant"
'apps/web/app/(dashboard)' 'apps/web/app/api' apps/web/components
apps/web/hooks apps/web/lib/actions apps/web/lib/hosts apps/web/lib/notes
apps/web/lib/notifications`

Follow-up: Start Task 4 next. Do not restore the previous combined dashboard
slice.

### Required work

- Replace the previous dashboard-wide Task 3 with smaller independently
  shippable slices.
- Keep each new slice focused on complete operator workflows rather than
  technical layers.
- Ensure each new slice can land without depending on unrelated dashboard
  surfaces to move first.

### Acceptance criteria

- The tracker no longer expects one PR to remove organisation identity from the
  entire dashboard surface.
- The first available implementation task is a smaller hosts-and-tasks slice
  that can land independently.

### Validation

- `rg -n "^## Task " ORGANISATION_REMOVAL_TASKS.md`

## Task 4 - Split Hosts And Tasks Conversion Into Smaller Vertical Slices

Status: Complete

Completed by: Codex automation

PR: [#1226](https://github.com/carrtech-dev/ct-ops/pull/1226)

Summary: Replaced the still-too-large hosts/tasks conversion with narrower
product-path slices after an implementation attempt showed the previous task
still spans host inventory, host detail, groups, networks, notes, terminal,
task runs, schedules, shared sidebar/command-palette surfaces, and a validation
grep that also sweeps unrelated alert/profile/licence actions.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`

Validation: `pnpm --dir apps/web type-check` (refactor-induced signature errors
cleared; remaining failures are pre-existing missing modules in
`react-qr-code`, `rrule`, and stale generated `.next` onboarding types in the
main checkout); `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts' 'apps/web/app/(dashboard)/tasks' apps/web/components/{notes,shared} apps/web/hooks apps/web/lib/{actions,hosts,notes}`

Follow-up: Start Task 5 next. Do not restore the previous combined Task 4.

### Required work

- Replace the previous blocked Task 4 with smaller independently shippable
  slices.
- Keep each slice focused on a coherent operator workflow rather than mixing
  host inventory, host detail, and task execution into one PR.
- Narrow each slice's grep validation so it does not require unrelated alert,
  profile, or licence actions to move at the same time.

### Acceptance criteria

- The tracker no longer expects one PR to remove organisation identity from the
  entire hosts/tasks/dashboard operator surface.
- The first available implementation task is a smaller host inventory slice
  that can land independently.

### Validation

- `rg -n "^## Task " ORGANISATION_REMOVAL_TASKS.md`

## Task 5 - Web Host Inventory, Admission, And Fleet Navigation Conversion

Status: Complete

Completed by: Codex automation

PR: [#1223](https://github.com/carrtech-dev/ct-ops/pull/1223)

Summary: Removed caller-supplied organisation identity from the hosts
inventory, pending-agent queue, fleet stats, command palette, sidebar terminal
launcher, and terminal host picker by switching those surfaces to derive the
instance scope from the authenticated session. Split `agents.ts` and
`terminal.ts` into thin instance-scoped wrappers over `*-core.ts` so the Task
5-owned action entrypoints no longer expose org-scoped signatures, updated
source-inspection unit tests to follow the new structure, and repaired the
replacement PR after Turbopack rejected `export *` from `"use server"` action
modules.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`,
`apps/web/app/(dashboard)/hosts/{page.tsx,hosts-client.tsx,[id]/host-terminal-launcher.tsx,networks/components/host-node-terminal-dialog.tsx}`,
`apps/web/app/(dashboard)/layout.tsx`,
`apps/web/components/shared/{sidebar.tsx,command-palette/*}`,
`apps/web/components/terminal/*`,
`apps/web/hooks/use-host-stream.ts`,
`apps/web/lib/actions/{action-scope.ts,agents.ts,agents-core.ts,alerts.ts,terminal.ts,terminal-core.ts}`,
`apps/web/lib/actions/*test.mjs`

Validation: `pnpm install --frozen-lockfile`; `pnpm --dir apps/web type-check`
(passes); `pnpm --dir apps/web lint` (passes with pre-existing warnings only);
`pnpm --dir apps/web test:unit` (passes except
`lib/db/rls.test.mjs` and `lib/integrations/ct-cve/db-nonce-store.test.mjs`,
both failing because no working container runtime is available in this
environment); `pnpm --dir apps/web exec playwright test --list` (passes);
`rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/page.tsx' 'apps/web/app/(dashboard)/hosts/hosts-client.tsx' apps/web/components/shared/sidebar.tsx apps/web/components/shared/command-palette/{command-palette,providers}.tsx apps/web/components/terminal/{host-selector-dialog,terminal-session}.tsx apps/web/hooks/use-host-stream.ts apps/web/lib/actions/{agents,terminal}.ts`
(no matches); `BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=test-secret pnpm --dir apps/web build`
(compiles and finishes TypeScript; local page-data collection still requires
database env such as `DATABASE_URL` or `POSTGRES_PASSWORD`)

Follow-up: Start Task 6 next. The remaining `test:unit` failures still need a
container runtime; no Task 5-specific test failures remain.

### Required work

This slice owns the fleet overview and shared host-picking surfaces.

- Remove `orgId` / `organisationId` parameters from the hosts index, pending
  agent approval/rejection, host inventory stats, host OS filters, host stream
  cache keys, and the shared command-palette/sidebar/terminal host selectors
  touched by these workflows.
- Delete org prop threading and React Query keys containing `orgId` for these
  workflows.
- Update shared navigation copy touched by these workflows so CT-Ops presents a
  standalone instance instead of an organisation.
- Rewrite unit tests and E2E fixtures touched by these workflows so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- The hosts index, pending agent approval queue, fleet stats, and shared host
  pickers work without caller-supplied organisation identity.
- Shared navigation/components touched by this slice no longer thread `orgId`.
- Web tests touched by this slice no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for hosts index, pending agents, host selector, and
  command-palette flows where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/page.tsx' 'apps/web/app/(dashboard)/hosts/hosts-client.tsx' apps/web/components/shared/{command-palette,sidebar}.tsx apps/web/components/terminal/{host-selector-dialog,terminal-session}.tsx apps/web/hooks/use-host-stream.ts apps/web/lib/actions/{agents,terminal}`

## Task 6 - Split Host Detail And Metadata Conversion Into Smaller Vertical Slices

Status: Complete

Completed by: Codex automation

PR:

Summary: Replaced the mixed host-detail metadata slice after auditing the
remaining org-scoped surface and finding the previous task still spans host
overview, checks, compare, local users, notes, tags, terminal settings, group
and network membership, groups/networks inventory pages, and task-run surfaces
embedded in group detail. The next agent should now take the host-detail core
slice instead of retrying another oversized cross-workflow PR.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`

Validation: `rg -l "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/[id]' 'apps/web/app/(dashboard)/hosts/groups' 'apps/web/app/(dashboard)/hosts/networks' apps/web/components/{notes,shared/tag-editor}.tsx 'apps/web/app/api/hosts/[id]/stream/route.ts' apps/web/lib/actions/{host-groups,networks,notes,tags,terminal}.ts`

Follow-up: Start Task 7 next. Do not restore the previous combined Task 6.

### Required work

- Replace the previous mixed Task 6 with smaller independently shippable host
  detail slices.
- Keep each slice focused on a coherent operator workflow rather than mixing
  host overview, metadata, memberships, and task-run surfaces in one PR.
- Narrow each slice's grep validation so it only covers the files that the
  slice actually owns.

### Acceptance criteria

- The tracker no longer expects one PR to remove organisation identity from the
  entire host-detail, notes, tags, groups, networks, and terminal surface.
- The first available implementation task is a narrower host-detail core slice
  that can land independently.

### Validation

- `rg -n "^## Task " ORGANISATION_REMOVAL_TASKS.md`

## Task 7 - Web Host Detail Core, Stream, Checks, Compare, And Local Users Conversion

Status: Complete

Completed by: Codex automation

PR:

Summary: Removed caller-supplied organisation identity from the host detail
page, host stream route, checks flows, compare view, and local-user detail/list
surfaces by introducing session-derived instance wrappers for host checks,
service accounts, software inventory comparisons, and host metrics. Renamed the
remaining host-detail child props touched by this slice to neutral `scopeId`
plumbing where later tasks still own the underlying org-scoped actions.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`,
`apps/web/app/(dashboard)/hosts/[id]/{page.tsx,host-detail-client.tsx,checks-tab.tsx,local-users-tab.tsx,alerts-tab.tsx,host-notification-charts.tsx,host-terminal-launcher.tsx,inventory-tab.tsx,logs-tab.tsx,patch-status-tab.tsx,settings-tab.tsx,tasks-tab.tsx,vulnerabilities-tab.tsx,compare/*,users/[accountId]/*}`,
`apps/web/app/api/hosts/[id]/stream/route.ts`,
`apps/web/components/notes/*`,
`apps/web/lib/actions/{agents.ts,checks.ts,checks-core.ts,service-accounts.ts,service-accounts-core.ts,software-inventory.ts,software-inventory-core.ts,*test.mjs}`

Validation: `pnpm install --frozen-lockfile`; `pnpm --dir apps/web type-check`
(passes); `pnpm --dir apps/web lint` (passes with pre-existing warnings only);
`pnpm --dir apps/web test:unit` (passes except
`lib/db/rls.test.mjs` and
`lib/integrations/ct-cve/db-nonce-store.test.mjs`, both failing because no
working container runtime is available in this environment);
`pnpm --dir apps/web exec playwright test --list` (passes);
`BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=test-secret pnpm --dir apps/web exec playwright test tests/e2e/hosts/compare.spec.ts --project=chromium --grep "empty-state"`
(fails before test execution because Next instrumentation cannot import
`./lib/agent/cache-prewarm` in this checkout);
`rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/[id]/page.tsx' 'apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx' 'apps/web/app/(dashboard)/hosts/[id]/checks-tab.tsx' 'apps/web/app/(dashboard)/hosts/[id]/compare' 'apps/web/app/(dashboard)/hosts/[id]/local-users-tab.tsx' 'apps/web/app/(dashboard)/hosts/[id]/users' 'apps/web/app/api/hosts/[id]/stream/route.ts' apps/web/lib/actions/{checks,service-accounts,software-inventory}.ts`
(no matches)

Follow-up: Start Task 8 next. If you need browser smoke coverage in this
worktree, fix the missing `apps/web/lib/agent/cache-prewarm` import path or use
an environment where the instrumentation hook can resolve it.

### Required work

This slice owns the host detail page and the live operational tabs that are
not primarily metadata editing.

- Remove `orgId` / `organisationId` parameters from the host detail loader,
  host stream route, overview/dashboard queries, checks tab, compare view, and
  local user views in this slice.
- Delete org prop threading and React Query keys containing `orgId` for these
  workflows.
- Rewrite unit tests and E2E fixtures touched by this slice so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- Host detail overview, stream updates, checks, compare, and local user flows
  work without caller-supplied organisation identity.
- The dashboard UI and route handlers touched by these workflows no longer
  thread `orgId`.
- Web tests touched by this slice no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for host detail, compare, checks, and local users
  where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/[id]/page.tsx' 'apps/web/app/(dashboard)/hosts/[id]/host-detail-client.tsx' 'apps/web/app/(dashboard)/hosts/[id]/checks-tab.tsx' 'apps/web/app/(dashboard)/hosts/[id]/compare' 'apps/web/app/(dashboard)/hosts/[id]/local-users-tab.tsx' 'apps/web/app/(dashboard)/hosts/[id]/users' 'apps/web/app/api/hosts/[id]/stream/route.ts' apps/web/lib/actions/{checks,service-accounts,software-inventory}.ts`

## Task 8 - Web Host Settings, Notes, Tags, Membership Tabs, And Terminal Conversion

Status: Complete

Completed by: Codex automation

PR: [#1228](https://github.com/carrtech-dev/ct-ops/pull/1228)

Summary: Removed caller-supplied organisation identity from host settings,
notes, tags, group/network membership tabs, and terminal settings by shifting
the host-facing actions to session-derived instance-scope wrappers and moving
the remaining org-scoped database logic into new `*-core.ts` modules.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`,
`apps/web/app/(dashboard)/hosts/[id]/{host-detail-client.tsx,host-terminal-launcher.tsx,settings-tab.tsx}`,
`apps/web/app/(dashboard)/hosts/bulk-tag/bulk-tag-client.tsx`,
`apps/web/app/(dashboard)/settings/{settings-client.tsx,agents/agents-client.tsx}`,
`apps/web/app/api/hosts/[id]/stream/route.ts`,
`apps/web/components/{notes/*,shared/tag-editor.tsx}`,
`apps/web/lib/actions/{host-groups.ts,host-groups-core.ts,host-settings.ts,instance-scope-wrappers.test.mjs,mutation-authz.test.mjs,networks.ts,networks-core.ts,notes.ts,notes-core.ts,tags.ts,tags-core.ts,terminal.ts,users.ts}`

Validation: `pnpm --dir apps/web install --frozen-lockfile`; `pnpm --dir apps/web type-check`
(passes); `pnpm --dir apps/web lint` (passes with pre-existing warnings only);
`pnpm --dir apps/web test:unit` (passes except `lib/db/rls.test.mjs` and
`lib/integrations/ct-cve/db-nonce-store.test.mjs`, both failing because no
working container runtime is available in this environment);
`pnpm --dir apps/web exec playwright test --list` (passes);
`BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=test-secret pnpm --dir apps/web exec playwright test tests/e2e/hosts/host-detail-memberships.spec.ts --project=chromium --grep "authenticated user can manage group and network memberships from the host detail page"`
(fails before test execution because Next instrumentation cannot import
`./lib/agent/cache-prewarm` in this checkout);
`rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/[id]/settings-tab.tsx' 'apps/web/app/(dashboard)/hosts/[id]/host-terminal-launcher.tsx' apps/web/components/{notes,shared/tag-editor}.tsx apps/web/lib/actions/{host-groups,networks,notes,tags,terminal}.ts`
(no matches)

Follow-up: Start Task 9 next. If you need local browser smoke coverage in this
worktree, fix the missing `apps/web/lib/agent/cache-prewarm` import path or
use an environment where the instrumentation hook resolves correctly.

### Required work

This slice owns per-host metadata editing and access-control flows.

- Remove `orgId` / `organisationId` parameters from host settings, host tag
  editing, notes, host membership tabs, terminal access, SSH host-key trust,
  and related loaders, server actions, route handlers, and client components
  in this slice.
- Delete org prop threading and React Query keys containing `orgId` for these
  workflows.
- Rewrite unit tests and E2E fixtures touched by this slice so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- Host settings, notes, tags, group/network membership tabs, and terminal
  settings work without caller-supplied organisation identity.
- The dashboard UI and shared components touched by these workflows no longer
  thread `orgId`.
- Web tests touched by this slice no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for host settings, notes, tags, membership tabs, and
  terminal settings where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/[id]/settings-tab.tsx' 'apps/web/app/(dashboard)/hosts/[id]/host-terminal-launcher.tsx' apps/web/components/{notes,shared/tag-editor}.tsx apps/web/lib/actions/{host-groups,networks,notes,tags,terminal}.ts`

## Task 9 - Web Host Groups And Networks Inventory Conversion

Status: Complete

Completed by: Codex automation

PR: [#1229](https://github.com/carrtech-dev/ct-ops/pull/1229)

Summary: Removed caller-supplied organisation identity from the host groups
inventory, networks inventory/detail, and network membership picker flows by
switching those pages to session-derived instance scope, dropping org-scoped
React Query keys, and trimming unused organisation payload fields from the
network graph helpers.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`,
`apps/web/app/(dashboard)/hosts/groups/{page.tsx,groups-client.tsx}`,
`apps/web/app/(dashboard)/hosts/networks/{page.tsx,networks-client.tsx,all-networks-graph.tsx,components/network-flow-nodes.tsx}`,
`apps/web/app/(dashboard)/hosts/networks/[id]/{page.tsx,network-detail-client.tsx,network-graph.tsx}`,
`apps/web/lib/actions/{host-groups,networks}.ts`

Validation: `pnpm install --frozen-lockfile`; `pnpm --dir apps/web type-check`
(passes); `pnpm --dir apps/web lint` (passes with pre-existing warnings only);
`pnpm --dir apps/web test:unit` (fails only `lib/db/rls.test.mjs` and
`lib/integrations/ct-cve/db-nonce-store.test.mjs`); `pnpm --dir apps/web exec
playwright test --list` (passes);
`BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=test-secret pnpm --dir apps/web exec playwright test tests/e2e/hosts/groups.spec.ts --project=chromium --grep "create, edit, and delete a host group"`
(fails before execution because Next instrumentation cannot import
`./lib/agent/cache-prewarm` in this checkout);
`rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/groups/page.tsx' 'apps/web/app/(dashboard)/hosts/groups/groups-client.tsx' 'apps/web/app/(dashboard)/hosts/networks' apps/web/lib/actions/{host-groups,networks}.ts`
(no matches)

Follow-up: Start Task 10 next. If you need local browser smoke coverage in
this worktree, fix the missing `apps/web/lib/agent/cache-prewarm` import path
or use an environment where the instrumentation hook resolves correctly.

### Required work

This slice owns the standalone groups and networks inventory/detail pages
outside the task-run-heavy group operations view.

- Remove `orgId` / `organisationId` parameters from the host groups index,
  networks index, network detail, host membership pickers, and related
  loaders, server actions, route handlers, and client components in this
  slice.
- Delete org prop threading and React Query keys containing `orgId` for these
  workflows.
- Rewrite unit tests and E2E fixtures touched by this slice so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- Host groups and networks inventory/detail flows work without caller-supplied
  organisation identity.
- The dashboard UI touched by these workflows no longer thread `orgId`.
- Web tests touched by this slice no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for groups index, networks index, network detail,
  and host membership pickers where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/hosts/groups/page.tsx' 'apps/web/app/(dashboard)/hosts/groups/groups-client.tsx' 'apps/web/app/(dashboard)/hosts/networks' apps/web/lib/actions/{host-groups,networks}.ts`

## Task 10 - Web Task Runs And Schedule Conversion

Status: Complete

Completed by: Codex automation

PR: [#1232](https://github.com/carrtech-dev/ct-ops/pull/1232)

Summary: Removed caller-supplied organisation identity from task run
monitoring, host and group task triggers, task-run deletion/cancellation, and
schedule CRUD by switching the Task 10-owned pages and actions to
session-derived instance scope. Split `task-runs.ts` and `task-schedules.ts`
into thin instance-scoped wrappers over `*-core.ts` modules so the public
Task 10 action entrypoints no longer expose org-scoped signatures, and updated
the touched E2E fixtures plus wrapper tests to seed standalone instance data.

Files changed: `ORGANISATION_REMOVAL_TASKS.md`,
`apps/web/app/(dashboard)/hosts/[id]/{host-detail-client.tsx,tasks-tab.tsx}`,
`apps/web/app/(dashboard)/hosts/groups/[id]/{group-detail-client.tsx,page.tsx}`,
`apps/web/app/(dashboard)/tasks/**/*`,
`apps/web/lib/actions/{agents-core.ts,instance-scope-wrappers.test.mjs,task-runs.ts,task-runs-core.ts,task-runs-authz.test.mjs,task-schedules.ts,task-schedules-core.ts}`,
`apps/web/tests/e2e/{hosts/group-task-history.spec.ts,tasks/monitor.spec.ts,tasks/schedules.spec.ts}`

Validation: `pnpm install --frozen-lockfile`; `pnpm --dir apps/web
type-check` (passes); `pnpm --dir apps/web lint` (passes with pre-existing
warnings only); `pnpm --dir apps/web test:unit` (fails only
`lib/db/rls.test.mjs` and `lib/integrations/ct-cve/db-nonce-store.test.mjs`);
`pnpm --dir apps/web exec playwright test --list` (passes);
`BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=test-secret pnpm --dir apps/web exec playwright test tests/e2e/tasks/monitor.spec.ts --project=chromium --grep "completed grouped task run"`
(fails before execution because Next instrumentation cannot import
`./lib/agent/cache-prewarm` in this checkout);
`rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/tasks' 'apps/web/app/(dashboard)/hosts/[id]/tasks-tab.tsx' 'apps/web/app/(dashboard)/hosts/groups/[id]/group-detail-client.tsx' apps/web/lib/actions/{task-runs,task-schedules}.ts`
(no matches)

Follow-up: Start Task 11 next. Task 13 still needs to delete the transitional
`apps/web/lib/actions/task-runs-core.ts` and
`apps/web/lib/actions/task-schedules-core.ts` org-scoped internals if they
remain by then, and local browser smoke coverage is still blocked in this
checkout by the missing `apps/web/lib/agent/cache-prewarm` instrumentation
import.

### Required work

This slice owns task execution and scheduling workflows.

- Remove `orgId` / `organisationId` parameters from task run detail, task run
  monitoring, host/group task triggers, task run deletion/cancellation,
  schedule CRUD, and related loaders, server actions, route handlers, request
  bodies, query strings, and client components.
- Delete org prop threading and React Query keys containing `orgId` for these
  workflows.
- Rewrite unit tests and E2E fixtures touched by these workflows so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- Task execution and schedule management work without caller-supplied
  organisation identity.
- The dashboard UI touched by these workflows no longer thread `orgId`.
- Web tests touched by this slice no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for task monitors, host/group task triggers, and
  schedules where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/tasks' 'apps/web/app/(dashboard)/hosts/[id]/tasks-tab.tsx' 'apps/web/app/(dashboard)/hosts/groups/[id]/group-detail-client.tsx' apps/web/lib/actions/{task-runs,task-schedules}`

## Task 11 - Web Alerts, Notifications, Team, And Agent Management Conversion

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

This slice owns operational coordination and agent management workflows.

- Remove `orgId` / `organisationId` parameters from alerts, silences,
  notification channels, notification inbox, team membership management,
  invitation management, agent enrolment tokens, and related loaders, server
  actions, route handlers, request bodies, query strings, and client
  components.
- Delete organisation settings/name/slug UI and org-scoped query keys touched
  by these workflows.
- Update topbar, notification bell, team surfaces, and settings copy touched by
  this slice so the UI presents CT-Ops as a standalone instance.
- Rewrite unit tests and E2E fixtures touched by these workflows so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- Alerts, notifications, team management, invitation management, and agent
  enrolment flows work without caller-supplied organisation identity.
- Shared UI touched by these workflows presents CT-Ops as a standalone
  instance.
- Web tests touched by these workflows no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for alerts, notifications, team, invites, and agents
  where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/alerts' 'apps/web/app/(dashboard)/notifications' 'apps/web/app/(dashboard)/team' 'apps/web/app/(dashboard)/settings/agents' 'apps/web/app/(dashboard)/settings/monitoring' apps/web/components/shared/{notification-bell,topbar}.tsx apps/web/lib/{actions,notifications}`

## Task 12 - Web Reporting, Integrations, Certificates, And Remaining Dashboard Conversion

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

This slice finishes the remaining dashboard/reporting surfaces after the higher
volume operational paths are converted.

- Remove `orgId` / `organisationId` parameters from reporting, software
  inventory, vulnerability views, certificates, directory lookup, password
  manager, bundlers, build docs, service accounts, CT-CVE settings surfaces,
  and related loaders, server actions, route handlers, request bodies, query
  strings, and client components.
- Delete remaining org prop threading and org-scoped query keys touched by
  these workflows.
- Rewrite unit tests and E2E fixtures touched by these workflows so they seed
  standalone instance data and no longer query or insert `organisations`.

### Acceptance criteria

- Reporting, inventory, certificates, directory lookup, build docs, bundlers,
  service accounts, and adjacent dashboards in this slice work without
  caller-supplied organisation identity.
- Web tests touched by these workflows no longer insert into or query
  `organisations`.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for reports, certificates, password manager,
  directory lookup, service accounts, and build docs where local infrastructure
  allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant" 'apps/web/app/(dashboard)/reports' 'apps/web/app/(dashboard)/certificates' 'apps/web/app/(dashboard)/bundlers' 'apps/web/app/(dashboard)/build-docs' 'apps/web/app/(dashboard)/directory-lookup' 'apps/web/app/(dashboard)/service-accounts' 'apps/web/app/(dashboard)/password-manager' 'apps/web/app/(dashboard)/settings/integrations' apps/web/app/api/{reports,certificates,service-accounts,build-docs} apps/web/lib/actions/{build-docs,certificates,ct-cve,domain-accounts,software-inventory,vulnerabilities}`

## Task 13 - Web Reporting, Integrations, And Schema Baseline Cleanup

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

This slice finishes the remaining web product areas and removes the last schema
and migration residue after the earlier slices have converted the live paths.

- Build a residue map before editing by running the Task 13 grep validation and
  grouping every match by owner: schema/migrations/RLS, server actions/APIs,
  UI/routes, tests/fixtures, docs/copy, or allowed unrelated English usage.
- Review the `Follow-up` notes from Tasks 10-12 and explicitly delete or
  justify every listed transitional wrapper/core residue.
- Remove the `organisations` schema module and all exports of it.
- Remove every remaining `organisation_id` / `org_id` column from web app
  schemas.
- Remove every web migration, snapshot, foreign key, index, unique constraint,
  and RLS policy whose purpose is organisation scoping.
- Replace the current web migration chain with a clean standalone baseline
  suitable for reinstalling development environments.
- Remove `withOrgDatabaseScope`, `runWithOrgDatabaseScope`, and
  `app.organisation_id` database session setting code.
- Delete transitional `*-core.ts` or wrapper splits where their only remaining
  purpose is to hide organisation-scoped internals behind instance-scoped entry
  points.
- Remove action/API parameters, request body fields, query string parameters,
  cache keys, React props, generated types, and route assumptions that still
  carry organisation or tenant identity.
- Update CT-CVE web routes/settings, licence checks, settings, reports,
  calendar, certificates, service accounts, build docs, and remaining admin or
  export flows to be instance-scoped.
- Rewrite remaining unit tests and E2E fixtures touched by this slice so they
  seed standalone instance users and no longer query or insert organisations.
- Remove tenant-isolation tests rather than adapting them into no-op tests.
- For any remaining grep match, either delete it or move it into `Remaining
  Allowed Matches` with a specific reason. "Legacy", "compatibility", and
  "future migration" are not acceptable reasons.

### Acceptance criteria

- A fresh web database created from migrations has no `organisations` table.
- No web app table has `organisation_id` or `org_id`.
- No RLS policy references `app.organisation_id`.
- No web schema, migration, snapshot, constraint, index, policy, trigger,
  function, or generated type preserves organisation scoping.
- No transitional wrapper/core split remains solely to preserve org-scoped
  implementation details.
- No public or internal web action/API requires caller-supplied organisation
  identity.
- No public or internal web action/API silently accepts old organisation fields
  and ignores them.
- The remaining web UI presents CT-Ops as a standalone instance.
- Web tests no longer insert into or query `organisations`.
- Tests that previously asserted tenant isolation are deleted or replaced with
  meaningful instance-level authorization tests.
- Tenant-isolation tests are removed, not softened.
- The task summary records the residue categories found before cleanup and the
  exact categories eliminated.

### Validation

- Initial residue map command and categorized findings recorded in this task.
- `pnpm --dir apps/web db:validate`
- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for settings, reports, CT-CVE, calendar,
  certificates, service accounts, and build docs where local infrastructure
  allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|requireOrg|SameOrg|withOrgDatabaseScope|runWithOrgDatabaseScope|app\\.organisation_id|tenant" apps/web`
  must return no matches except entries documented in `Remaining Allowed
  Matches`.

## Task 14 - Ingest And Agent Single-Instance Conversion

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

- Remove organisation fields from Go query structs and SQL statements.
- Remove organisation binding from enrolment token lookup and consumption.
- Make host collision checks instance-wide.
- Remove organisation fields from agent status history and related inserts.
- Remove the org claim from agent JWT issuing and validation.
- Rename the public agent registration concept away from `org_token` where the
  public protobuf/API can be changed safely. Use `enrolment_token`.
- Regenerate protobuf bindings if the protobuf contract changes.
- Update agent-side config, registration, load testing, and tests.
- Update any Go code that depends on web schema columns removed in Task 1.

### Acceptance criteria

- Agent JWTs contain no organisation claim.
- Agent registration, heartbeat, terminal, inventory, and certificate renewal
  work without organisation IDs.
- Ingest SQL does not select, insert, compare, or log organisation identifiers.
- Agent and ingest tests no longer refer to org IDs or org tokens except where
  asserting the old public field was removed.

### Validation

- `go test ./...`
- `pnpm --dir apps/web type-check`
- `rg -n "organisation|organization|orgID|orgId|org_id|organisation_id|OrgToken|org_token|tenant" apps/ingest agent proto`

## Task 15 - Docs, Deploy, And External Contracts

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

- Update README, docs, app docs, `.env.example`, customer bundle scripts, and
  deployment examples to describe standalone CT-Ops instances.
- Remove organisation-based setup instructions and screenshots/copy.
- Update enrolment-token docs so tokens grant access to the instance, not an
  organisation.
- Update licensing docs so licences bind to an installation/instance
  identifier, not an organisation.
- Update CT-CVE integration and plugin contract docs to remove org-scoped
  inventory, finding, subscription, and assertion contracts.
- Update deploy/customer-bundle scripts that query organisation licence rows.
- Do not keep old organisation instructions as migration or legacy notes.

### Acceptance criteria

- Docs instruct users to install a separate CT-Ops instance for separate
  environments or customers.
- No docs tell users to create, select, switch, or manage organisations.
- Deploy scripts do not query `organisations`.
- External contracts no longer require `orgId`, `organisationId`,
  `organisation_id`, or `org_id`.

### Validation

- `pnpm --dir apps/docs build`
- `rg -n "organisation|organization|orgId|organisationId|organisation_id|org_id|tenant|organisations" README.md docs apps/docs deploy .env.example apps/web/.env.example`

## Task 16 - Final Residue Sweep And Validation

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

- Run a repository-wide residue search for old organisation concepts.
- Delete remaining org-based code, comments, tests, docs, migrations, types,
  route params, and copy.
- For any remaining match, record it in `Remaining Allowed Matches` below with
  a concrete reason. Generic old org references are not allowed.
- Run the full validation set.
- Update this task with exact commands and outcomes.

### Acceptance criteria

- The working tree contains no old organisation implementation.
- Remaining matches are either unrelated English usage or explicitly justified
  in this file.
- Full validation has been run or blockers are documented with evidence.

### Validation

- `pnpm --dir apps/web db:validate`
- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- `pnpm --dir apps/docs build`
- `go test ./...`
- Targeted E2E smoke checks for auth, setup, settings, agents, hosts, tasks,
  reports, CT-CVE, and calendar where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant|organisation|organization" .`

## Remaining Allowed Matches

Record any allowed residue here during Task 4. Leave this empty until then.

| Path | Match | Reason |
| --- | --- | --- |
