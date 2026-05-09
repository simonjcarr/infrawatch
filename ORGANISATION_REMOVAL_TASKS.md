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
  shapes, types, or UI copy as "legacy" references.
- Do not add a path to reinstate organisation features.
- Git history is the only history needed.
- Existing development data does not need to be preserved. Development installs
  can be deleted and reinstalled.

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
- Prefer renaming concepts to `instance`, `installation`, or `team` only when
  the product still needs a replacement concept.
- If you find a separate issue outside the selected task, create a GitHub issue
  as required by `AGENTS.md` rather than expanding scope.

Before finishing:

1. Run the validation listed for the selected task.
2. Update that task's status to `Complete`.
3. Fill in `Completed by`, `Summary`, `Files changed`, `Validation`, `PR`, and
   `Follow-up` for that task.
4. If a task cannot be completed, leave it as `Blocked`, explain exactly why,
   and list the next concrete action.

## Status Values

- `Not started`: available for the next agent.
- `In progress`: currently owned by an agent or PR.
- `Blocked`: cannot continue until the listed blocker is resolved.
- `Complete`: merged to `main` with validation recorded.

## Task 1 - Reset Schema And Migrations

Status: Blocked

Completed by: Codex automation `remove-org-from-ct-ops` on 2026-05-09

PR: Not opened

Summary:
Task 1 cannot currently be completed in isolation. Removing `organisations`,
`organisation_id`, and org-scoped RLS from `apps/web/lib/db` immediately breaks
type-checking across auth, dashboard pages, server actions, and CT-CVE
integrations because those layers still require `user.organisationId`,
`hosts.organisationId`, `notes.organisationId`, `withOrgDatabaseScope`, and the
organisation-backed settings record.

Files changed:
`ORGANISATION_REMOVAL_TASKS.md`

Validation:
Checked open PRs with `gh pr list --repo carrtech-dev/ct-ops --state open`.
Created a dedicated worktree and attempted the schema-only removal locally.
`pnpm --dir apps/web type-check` could be run after reusing the existing
`node_modules`; it produced hundreds of downstream errors outside `lib/db`,
including:
- `app/(auth)/login/page.tsx` and `app/(auth)/register/page.tsx` expecting `user.organisationId`
- `lib/auth/session.ts`, `lib/auth/guards.ts`, and `lib/auth/redirects.ts` requiring org-scoped auth types
- many dashboard pages and CT-CVE integration modules expecting org-owned table columns and `withOrgDatabaseScope`

Follow-up:
Combine Task 1 with a coordinated first pass of Tasks 2-5, or split out a new
prerequisite task that removes compile-time/runtime dependencies on
`organisationId` and `withOrgDatabaseScope` before the schema and migration
reset lands.

### Required work

- Remove the `organisations` schema module and all exports of it.
- Remove every `organisation_id` / `org_id` column from app schemas.
- Remove every foreign key, index, unique constraint, and row-level-security
  policy whose purpose is organisation scoping.
- Remove `withOrgDatabaseScope`, `runWithOrgDatabaseScope`, and
  `app.organisation_id` database session setting code.
- Replace org-owned settings with instance-level storage. Use an existing
  instance/system config table if it fits; otherwise create a clear standalone
  settings table.
- Replace the current migration chain with a clean standalone baseline suitable
  for reinstalling development environments. Do not add an additive
  organisation-removal migration that preserves old org structures.
- Update Drizzle snapshots and migration journal so `db:validate` passes.

### Acceptance criteria

- A fresh database created from migrations has no `organisations` table.
- No app table has `organisation_id` or `org_id`.
- No RLS policy references `app.organisation_id`.
- TypeScript schema exports contain no organisation model or organisation
  foreign keys.

### Validation

- `pnpm --dir apps/web db:validate`
- `pnpm --dir apps/web type-check`
- `rg -n "organisations|organisation_id|org_id|app\\.organisation_id|withOrgDatabaseScope|runWithOrgDatabaseScope" apps/web/lib/db`

## Task 2 - Remove Org Auth And Onboarding

Status: Blocked

Completed by: Codex automation `remove-org-from-ct-ops` on 2026-05-09

PR: Not opened

Summary:
Task 2 cannot currently be completed in isolation. The auth/onboarding files can
be rewritten, but the task's own validation and acceptance scope still requires
removing `organisationId`, `requireOrg*`, onboarding redirects, and LDAP tenant
assumptions from `apps/web/lib/actions` and route callers that are owned by
Task 3's API/action parameter cleanup.

Files changed:
`ORGANISATION_REMOVAL_TASKS.md`

Validation:
Reviewed auth/onboarding dependencies and ran
`rg -n "organisationId|orgId|requireOrg|SameOrg|onboarding|tenant" apps/web/lib/auth apps/web/lib/actions apps/web/app`.
That output shows Task 2 blockers outside auth-only files, including:
- `apps/web/lib/actions/alerts.ts`, `tags.ts`, `settings.ts`, `notifications.ts`, `calendar.ts`, `ldap.ts`, and many other server actions that still take `orgId` and call `requireOrg*`
- `apps/web/lib/actions/auth.ts` and `organisations.ts` still attaching invites and first-run setup to organisations
- auth pages and redirects still branching on `user.organisationId` because the surrounding action contracts remain org-scoped

Follow-up:
Combine Tasks 2 and 3 into a single auth/API de-organisation pass, or rewrite
Task 2 so it is limited to auth/session/redirect/onboarding files and does not
require removing org-scoped action parameters from `apps/web/lib/actions`.

### Required work

- Delete organisation creation actions and onboarding screens.
- Remove `users.organisationId` from auth/session/user types and all session
  loading logic.
- Remove org membership guards, same-org checks, and org-admin wrappers.
- Replace role checks with instance-level admin/write/read checks.
- Remove redirects that send users without an organisation to `/onboarding`.
- Remove LDAP tenant/organisation selection. LDAP configuration and login must
  be instance-scoped.
- Remove invitation assumptions that attach a user to an organisation. Invites
  should invite users into the instance.
- Ensure the first setup/admin flow belongs to the standalone instance.

### Acceptance criteria

- Authenticated users are never blocked because they lack an organisation.
- There is no `/onboarding` route for creating an organisation.
- Guard code talks about instance/user/role access, not organisation access.
- LDAP login does not ask for or resolve an organisation tenant.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `node --experimental-strip-types --test apps/web/lib/auth/*.test.mjs apps/web/lib/actions/*auth*.test.mjs`
- `rg -n "organisationId|orgId|requireOrg|SameOrg|onboarding|tenant" apps/web/lib/auth apps/web/lib/actions apps/web/app`

## Task 3 - Remove Org APIs And Action Params

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

- Remove `orgId` / `organisationId` parameters from server actions.
- Remove `orgId` query parameters and request body fields from API routes.
- Update callers so access is derived from the authenticated user and
  instance-level role only.
- Update CT-CVE routes, licence checks, settings, reports, notifications,
  tasks, hosts, tags, calendar, certificates, service accounts, and agent
  enrolment APIs.
- Do not keep compatibility overloads, aliases, or request fallbacks that accept
  org identifiers.
- Update audit events and rate-limit keys so they are instance-scoped or
  user-scoped as appropriate.

### Acceptance criteria

- No public or internal action requires caller-supplied organisation identity.
- API contracts do not document or accept `orgId`, `organisationId`, `org_id`,
  or `organisation_id`.
- Authorization failures depend on session/role state, not organisation
  matching.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `rg -n "orgId|organisationId|org_id|organisation_id|requireOrg" apps/web/lib/actions apps/web/app/api apps/web/app`

## Task 4 - Simplify Ingest And Agent Identity

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

### Acceptance criteria

- Agent JWTs contain no organisation claim.
- Agent registration, heartbeat, terminal, inventory, and certificate renewal
  work without organisation IDs.
- Ingest SQL does not select, insert, compare, or log organisation identifiers.

### Validation

- `go test ./...`
- `pnpm --dir apps/web type-check`
- `rg -n "organisation|orgID|orgId|org_id|organisation_id|OrgToken|org_token" apps/ingest agent proto`

## Task 5 - Clean Frontend UX

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

- Delete organisation settings/name/slug UI.
- Delete onboarding screens and navigation paths tied to organisation setup.
- Remove org prop threading through dashboard pages and client components.
- Remove React Query keys that include `orgId`.
- Replace user-facing "organisation" wording with `instance`,
  `installation`, `team`, or simpler wording only where a replacement concept is
  required.
- Remove organisation-specific settings cards, labels, placeholders, and
  validation text.
- Update sidebar, command palette, settings pages, team pages, CT-CVE settings,
  agent enrolment, reports, and dashboard copy.

### Acceptance criteria

- The UI presents CT-Ops as a standalone instance.
- No visible screen asks for an organisation name, slug, tenant, or org switch.
- Client components do not accept or pass org IDs.

### Validation

- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- Targeted Playwright list/smoke checks for auth, settings, agents, hosts,
  tasks, reports, CT-CVE, and calendar.
- `rg -n "orgId|organisationId|organisation|tenant|workspace" apps/web/app apps/web/components apps/web/hooks`

## Task 6 - Rewrite Tests And Fixtures

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

- Rewrite E2E fixtures to seed a standalone instance admin and users without
  organisations.
- Remove tenant-isolation tests. Do not adapt them into no-op tests.
- Update SQL fixtures and setup data across hosts, tasks, calendar, reports,
  LDAP, certificates, service accounts, tags, CT-CVE, alerts, notes, build
  docs, notifications, networks, and software inventory.
- Update unit/source tests that assert org-scoped auth helpers or SQL filters.
- Remove test helper names and constants such as `TEST_ORG`, `orgId`, and
  `getOrgId`.
- Keep meaningful access-control tests for instance-level roles.

### Acceptance criteria

- Tests no longer insert into or query `organisations`.
- Tests no longer seed `organisation_id`.
- No test depends on org-scoped auth helpers.
- Tenant-isolation tests are removed, not softened.

### Validation

- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for auth, settings, agents, hosts, tasks, reports,
  CT-CVE, and calendar where local infrastructure allows.
- `rg -n "TEST_ORG|getOrgId|orgId|organisationId|organisation_id|organisations|tenant" apps/web/tests apps/web/lib/**/*.test.mjs`

## Task 7 - Update Docs And Deploy Assets

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

### Validation

- `pnpm --dir apps/docs build`
- `rg -n "organisation|organization|orgId|organisationId|organisation_id|org_id|tenant|organisations" README.md docs apps/docs deploy .env.example apps/web/.env.example`

## Task 8 - Final Residue Sweep And Validation

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
- `go test ./...`
- Targeted E2E list/smoke checks for auth, setup, settings, agents, hosts,
  tasks, reports, CT-CVE, and calendar where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|tenant|organisation|organization" .`

## Remaining Allowed Matches

Record any allowed residue here during Task 8. Leave this empty until then.

| Path | Match | Reason |
| --- | --- | --- |
