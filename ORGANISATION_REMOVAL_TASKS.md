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

## Task 1 - Core Web Single-Instance Conversion

Status: Not started

Completed by:

PR:

Summary:

Files changed:

Validation:

Follow-up:

### Required work

This task supersedes the previously blocked schema-only, auth-only, and
API-only tasks. It must remove organisation concepts from the web app as one
coherent vertical change.

- Remove the `organisations` schema module and all exports of it.
- Remove every `organisation_id` / `org_id` column from web app schemas.
- Remove every web migration, snapshot, foreign key, index, unique constraint,
  and RLS policy whose purpose is organisation scoping.
- Replace the current web migration chain with a clean standalone baseline
  suitable for reinstalling development environments.
- Remove `withOrgDatabaseScope`, `runWithOrgDatabaseScope`, and
  `app.organisation_id` database session setting code.
- Replace org-owned settings with instance-level storage. Use the existing
  system config table if it fits; otherwise add a standalone instance settings
  table.
- Delete organisation creation actions and onboarding screens.
- Remove `users.organisationId` from auth/session/user types and all session
  loading logic.
- Replace org membership guards, same-org checks, and org-admin wrappers with
  instance-level role checks.
- Remove redirects that send users without an organisation to `/onboarding`.
- Remove LDAP tenant/organisation selection. LDAP configuration and login must
  be instance-scoped.
- Remove invitation assumptions that attach a user to an organisation. Invites
  should invite users into the instance.
- Remove `orgId` / `organisationId` parameters from web server actions,
  route handlers, request bodies, query strings, dashboard loaders, and client
  components.
- Update CT-CVE web routes/settings, licence checks, settings, reports,
  notifications, tasks, hosts, tags, calendar, certificates, service accounts,
  build docs, notes, alerts, networks, software inventory, and agent enrolment
  web code to be instance-scoped.
- Delete organisation settings/name/slug UI, org prop threading, React Query
  keys containing `orgId`, and user-facing organisation wording in the web UI.
- Rewrite web unit tests and E2E fixtures touched by this conversion so they
  seed standalone instance users and no longer query or insert organisations.
- Remove tenant-isolation tests rather than adapting them into no-op tests.

### Acceptance criteria

- A fresh web database created from migrations has no `organisations` table.
- No web app table has `organisation_id` or `org_id`.
- No RLS policy references `app.organisation_id`.
- Authenticated users are never blocked because they lack an organisation.
- There is no `/onboarding` route for creating an organisation.
- No public or internal web action/API requires caller-supplied organisation
  identity.
- The web UI presents CT-Ops as a standalone instance.
- Web tests no longer insert into or query `organisations`.
- Tenant-isolation tests are removed, not softened.

### Validation

- `pnpm --dir apps/web db:validate`
- `pnpm --dir apps/web type-check`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test:unit`
- `pnpm --dir apps/web exec playwright test --list`
- Targeted E2E smoke runs for auth, setup, settings, agents, hosts, tasks,
  reports, CT-CVE, and calendar where local infrastructure allows.
- `rg -n "orgId|organisationId|organisation_id|org_id|organisations|requireOrg|SameOrg|withOrgDatabaseScope|runWithOrgDatabaseScope|app\\.organisation_id|tenant" apps/web`

## Task 2 - Ingest And Agent Single-Instance Conversion

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

## Task 3 - Docs, Deploy, And External Contracts

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

## Task 4 - Final Residue Sweep And Validation

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
