# CTOps Password Vault Implementation Plan

This is the coordination file for agents building the built-in CTOps Password
Vault. Keep this file current as work lands so parallel sessions can pick the
next safe chunk without rediscovering the product direction.

## Product Direction

Password Vault is first-party CTOps functionality. It is not an external
plugin, it does not live in a separate repository, and it must not use the old
external password-manager plugin launch, licence, nginx, or repository model.

The first implementation target is a secure multi-user core vault:

- Browser-side encryption and decryption for vault and entry data.
- Multi-user shared vaults using per-user wrapped vault keys.
- No admin recovery in the MVP.
- No server-side access to plaintext vault names, entry titles, usernames,
  passwords, URLs, notes, TOTP seeds, tags, custom fields, unlock passwords,
  derived keys, vault keys, entry keys, or private keys.
- Backend-enforced organisation scoping, vault membership, roles, rate limits,
  input bounds, audit logging, and mutation-origin checks.

## Agent Operating Rules

Before starting any task:

- Read repo-root `AGENTS.md` and follow it exactly.
- Use a dedicated Git worktree for the task before editing files.
- Use test-driven development for implementation tasks unless the task is
  docs-only or the PR clearly documents why test-first is not practical.
- Pick the first `Not started` task whose dependencies are complete.
- Mark the task `In progress` with owner and timestamp before editing code.
- Do not start a task already marked `In progress` or `Complete` unless the
  existing owner has handed it off or the status is clearly stale and the PR or
  branch evidence confirms it is abandoned.
- Keep each session scoped to one task unless a dependency is tiny and directly
  required to complete the chosen task.
- At the end of the session, update the task row with final status, owner, PR,
  and concise notes on what changed or what remains blocked.
- Append a Handoff Log row with date, agent, task ID, status, PR, validation,
  and notes so the next agent can see progress without redoing completed work.
- Commit with a Conventional Commit message.
- Push, open a pull request, monitor checks, merge to `main`, confirm required
  release or artifact publication, and remove the task worktree as required by
  `AGENTS.md`.
- If unrelated security issues are discovered, create a focused GitHub issue
  rather than silently expanding scope.

Status values:

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

## Architecture Decisions

- Password Vault lives inside `apps/web` and uses CTOps authentication,
  organisation scoping, audit logging, documentation, and release workflow.
- Vault APIs are explicit route handlers under `/api/password-vault/...` rather
  than secret-bearing server actions, so request bodies can be inspected in E2E
  tests and mutation-origin checks are consistently enforced.
- Sensitive vault payloads are encrypted in the browser before they reach the
  API. Server-side validation checks envelope shape, size, version, IDs, roles,
  and membership, but never decrypts vault data.
- Unlock is separate from CTOps login. The unlock password never leaves the
  browser and is used only to decrypt the user's local private-key envelope.
- Use `libsodium-wrappers-sumo` for Argon2id key derivation and WebCrypto for
  AES-256-GCM encryption and ECDH/HKDF/AES-GCM key wrapping.
- Default Argon2id target is memory `64 MiB`, iterations `3`, parallelism `1`.
  The implementation must not go below OWASP's current Argon2id floor.
- No admin recovery exists in the MVP. Lost unlock credentials mean vault data
  is unrecoverable unless another unlocked authorized member can re-share.
- Removing a member immediately blocks backend access and requires an unlocked
  owner or admin to rotate the vault key epoch for future access. Previously
  viewed or copied secrets cannot be cryptographically clawed back.
- Database/API/admin compromise should not reveal vault plaintext, but a
  compromised CTOps web server could ship malicious JavaScript. The threat
  model and docs must state this clearly and harden around it.

## Security Standards Baseline

Agents should use current primary guidance when implementing and reviewing the
feature:

- NIST SP 800-63B-4 for authenticator and password guidance.
- NIST SP 800-57 Part 1 Rev. 5 for key-management lifecycle expectations.
- NIST SP 800-38D for AES-GCM authenticated encryption constraints.
- OWASP Password Storage Cheat Sheet for Argon2id parameter floors.
- OWASP Cryptographic Storage Cheat Sheet for key management, envelope
  encryption, rotation, and authenticated-encryption practices.

Use official NIST/OWASP sources when updating these standards references. If a
later standard conflicts with this file, update this file in the same PR as the
implementation decision.

## Implementation Tasks

| ID | Task | Dependencies | Status | Owner | PR | Expected session output |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Remove obsolete external password-manager plugin references | none | Complete | automation/work-on-password-manager |  | Rewrote CT-Passwd/external password-manager references into generic external-plugin guidance or explicit superseded-history notes; old repo slug removed from active docs. |
| 2 | Add built-in Password Vault architecture and threat model | 1 | Complete | automation/work-on-password-manager |  | Added `docs/password-vault-architecture.md` covering first-party boundaries, zero-knowledge limits, recovery posture, browser/server trust, key hierarchy, threat model, and standards alignment. |
| 3 | Add public docs shell and navigation | 2 | Complete | automation/work-on-password-manager | [#884](https://github.com/carrtech-dev/ct-ops/pull/884) | Added `apps/docs/docs/features/password-vault.md`, wired it into the docs sidebar, and documented the MVP boundary, sharing model, and no-recovery posture without promising deferred features. |
| 4 | Add schema test expectations first | 2 | Complete | automation/work-on-password-manager | [#886](https://github.com/carrtech-dev/ct-ops/pull/886) | Added a Password Vault schema contract plus unit tests covering the planned table set, organisation-scoped tables, membership and key-epoch constraints, audit actor links, and a no-plaintext-secret boundary. |
| 5 | Add vault schema and migration | 4 | Complete | automation/work-on-password-manager | [#895](https://github.com/carrtech-dev/ct-ops/pull/895) | Added the Drizzle Password Vault schema, generated migrations for the new tables, exported the schema, extended the schema contract to real tables, and added E2E truncation coverage; noted pre-existing Drizzle snapshot drift in issue `#894`. |
| 6 | Add browser crypto tests first | 2 | Complete | automation/work-on-password-manager | [#898](https://github.com/carrtech-dev/ct-ops/pull/898) | Added `apps/web/lib/password-vault/crypto.test.mjs` covering Argon2id KDF parameter serialisation, wrong-password unlock rejection, AES-GCM tamper rejection, nonce uniqueness, ECDH/HKDF vault-key wrapping, and plaintext-free envelope serialisation. |
| 7 | Implement browser crypto package | 6 | Complete | automation/work-on-password-manager | [#898](https://github.com/carrtech-dev/ct-ops/pull/898) | Added `apps/web/lib/password-vault/crypto.ts` with browser-only Argon2id KDF helpers, AES-GCM payload/private-key envelopes, ECDH/HKDF vault-key wrapping, and random key generation for later setup/API/UI tasks. |
| 8 | Add API authorization and validation tests first | 5 | Complete | automation/work-on-password-manager | [#902](https://github.com/carrtech-dev/ct-ops/pull/902) | Added `apps/web/lib/password-vault/api-policy.test.mjs` and `api-policy.ts` to lock route-level requirements for authenticated org sessions, org-scoped vault lookup, active membership, role gates, trusted mutation origins, body-size bounds, and sensitive-flow rate limits before API route implementation. |
| 9 | Implement vault setup/profile API | 7,8 | Complete | automation/work-on-password-manager | [#905](https://github.com/carrtech-dev/ct-ops/pull/905) | Added setup-status, user-key, and unlock-metadata route handlers that require org sessions, enforce trusted origins/rate limits/body bounds, validate opaque encrypted key envelopes/KDF params, and persist one race-safe user-key profile per user. |
| 10 | Implement vault CRUD API | 9 | Complete | automation/work-on-password-manager | [#913](https://github.com/carrtech-dev/ct-ops/pull/913) | Added encrypted-only vault payload validation plus list/create/get/update/delete routes that enforce org scoping, active membership, trusted mutation origins, body bounds, setup-before-create, and manager-only update/delete. |
| 11 | Implement entry CRUD API | 10 | Complete | automation/work-on-password-manager | [#920](https://github.com/carrtech-dev/ct-ops/pull/920) | Added encrypted-only entry payload validation plus list/create/get/update/delete routes that enforce org-scoped active vault membership, trusted mutation origins, read-body bounds, soft delete, and generic not-found responses. |
| 12 | Implement sharing and key-rotation API | 10 | Complete | automation/work-on-password-manager | [#925](https://github.com/carrtech-dev/ct-ops/pull/925) | Added member list/add/update/remove routes, encrypted per-member wrapped-key validation, owner-safety checks, share rate limiting, key-epoch rotation with one wrap per active member, and persisted idempotency keys for safe rotation retries. |
| 13 | Add audit event coverage | 11,12 | Complete | automation/work-on-password-manager | [#929](https://github.com/carrtech-dev/ct-ops/pull/929) | Added Password Vault audit helpers, no-secret metadata tests, audit writes for setup/vault/entry/share/key-rotation mutations, and origin-checked/rate-limited unlock/reveal/copy/export audit endpoints. |
| 14 | Add Password Vault route shell | 9 | Complete | automation/work-on-password-manager | [#938](https://github.com/carrtech-dev/ct-ops/pull/938) | Added `/password-vault`, sidebar navigation, command palette navigation, first-use/locked/empty/ready shell states, no-recovery warning, and stable route/navigation `data-testid` attributes. |
| 15 | Build first-use and unlock UI | 14,7 | Not started |  |  | Add unlock-password setup, unlock, lock, timeout, encrypted key loading, error states, and no-recovery warnings. |
| 16 | Build vault and entry management UI | 15,11 | Not started |  |  | Add vault list, entry list, create/edit/delete forms, password generator, reveal/copy controls, and encrypted folders/tags/custom fields. |
| 17 | Build sharing UI | 16,12 | Not started |  |  | Add member list, add member, role changes, revoke, rewrap, key-rotation prompt, and role-aware disabled states. |
| 18 | Add core browser E2E coverage | 16,17 | Not started |  |  | Cover setup, unlock, create entry, lock/unlock, reveal/copy audit, share, revoke, and network assertions proving plaintext fields are not sent. |
| 19 | Harden vault-specific web security | 18 | Not started |  |  | Tighten CSP/log redaction/dependency guidance for vault surfaces and document the residual malicious-JavaScript server-compromise risk. |
| 20 | Add backup, restore, and disaster-recovery docs | 13 | Not started |  |  | Document database backup scope, encrypted key material, no admin recovery, restore validation, and operator warnings. |
| 21 | Final security review and progress update | 19,20 | Not started |  |  | Review the threat model, run full relevant validation, update `PROGRESS.md`, and record residual risks and deferred features. |

## Suggested Database Shape

The exact Drizzle definitions belong in the schema task, but the implementer
should preserve these boundaries:

- `password_vault_user_keys`: one row per CTOps user containing public key,
  encrypted private-key envelope, KDF params, setup timestamps, and version.
- `password_vaults`: organisation-scoped vault records with encrypted display
  metadata, status, created/updated/deleted timestamps, and owner audit fields.
- `password_vault_key_epochs`: per-vault key epoch metadata, AEAD/wrap version,
  rotation reason, and rotation actor.
- `password_vault_members`: vault membership, role, wrapped vault-key envelope,
  current key epoch, and revoked/deleted timestamps.
- `password_vault_entries`: vault entry records containing encrypted payload
  envelope, encrypted search/display envelope where needed, version, updated
  actor, and deleted timestamp.

Plaintext columns must not contain secret fields. If an indexable/searchable
field is required, add it only after a separate design covers leakage tradeoffs.

## API Boundaries

Use route handlers under `/api/password-vault` with these minimum groups:

- `GET /setup-status`
- `GET/PUT /user-key`
- `GET /unlock-metadata`
- `GET/POST /vaults`
- `GET/PATCH/DELETE /vaults/:vaultId`
- `GET/POST /vaults/:vaultId/entries`
- `GET/PATCH/DELETE /vaults/:vaultId/entries/:entryId`
- `GET/POST /vaults/:vaultId/members`
- `PATCH/DELETE /vaults/:vaultId/members/:userId`
- `POST /vaults/:vaultId/key-epochs`
- `POST /vaults/:vaultId/entries/:entryId/reveal-audit`
- `POST /vaults/:vaultId/entries/:entryId/copy-audit`

Every route must:

- derive the acting user and organisation from the CTOps session;
- enforce organisation and vault membership server-side;
- validate inputs with Zod before touching the database;
- reject over-large payloads and unknown envelope versions;
- use trusted mutation-origin checks for state-changing requests;
- rate-limit setup/unlock-audit/share/export-sensitive paths;
- return generic errors for authorization and crypto-envelope failures;
- avoid logging raw request bodies or ciphertext previews.

## Validation Requirements

Each PR must run the relevant subset:

- targeted `rg` checks for the task scope
- `git diff --check`
- targeted Markdown sanity check for docs-only changes
- `pnpm --filter web test:unit`
- `pnpm --filter web db:validate`
- `pnpm --filter web type-check`
- `pnpm --filter web lint`
- `pnpm --filter web build`
- targeted `pnpm --filter web test:e2e`

Task 1 must additionally prove that the old external password-manager product
name, repository slug, sample instance ID, and launch/licence references no
longer remain in CTOps docs or progress history, except where a retained
historical note is deliberately rewritten to say the direction was superseded by
the built-in Password Vault.

## MVP Acceptance Criteria

- The obsolete external-plugin direction is removed from CTOps documentation.
- Password Vault appears as a built-in CTOps feature.
- Users can set up an unlock profile without sending unlock material to the
  server.
- Users can create, lock, unlock, update, delete, reveal, and copy encrypted
  vault entries.
- Multiple users can access a shared vault through per-user wrapped vault keys.
- Removing a user blocks backend access and rotates the key epoch for future
  access.
- Server-side APIs never receive or return plaintext secret fields.
- Audit logs record sensitive actions but never secret values.
- No admin recovery exists in the MVP and the UI/docs clearly explain the
  consequence.

## Deferred Features

- Importers from third-party password managers.
- Browser extension.
- Attachments.
- Breach checks and password-health scoring.
- Emergency access.
- Admin or organisation recovery.
- Shamir split recovery.
- Hardware-token recovery.
- Secret rotation automation.
- SIEM forwarding.
- Advanced anomaly detection.
- Search over encrypted fields beyond local in-browser filtering.

## Handoff Log

| Date | Agent | Task | Status | PR | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-04 | automation/work-on-password-manager | 1 | Complete |  | `rg -n "CT-Passwd|ct-passwd|git@github.com:simonjcarr/ct-passwd.git" docs PROGRESS.md`; `git diff --check`; Markdown fence/tab sanity check | Removed active external password-manager direction from shared docs, kept only an explicit superseded historical note in `PROGRESS.md`, and preserved generic CT-CVE/plugin broker guidance. |
| 2026-05-04 | automation/work-on-password-manager | 2 | Complete |  | `git diff --check`; `pnpm --filter @ct-ops/docs build` (fails: `vuepress` not installed in this worktree) | Added `docs/password-vault-architecture.md` as the internal source of truth for built-in vault boundaries, key hierarchy, recovery posture, residual malicious-JavaScript risk, and backend security constraints. |
| 2026-05-04 | automation/work-on-password-manager | 3 | Complete | [#884](https://github.com/carrtech-dev/ct-ops/pull/884) | `git diff --check`; `rg -n "Password Vault|password-vault" apps/docs/docs apps/docs/docs/.vuepress/config.ts`; Markdown tab sanity check; `pnpm --filter @ct-ops/docs build` | Added a public Password Vault feature page and sidebar entry that describe the built-in CT-Ops vault MVP, browser-side encryption boundary, shared-vault model, and no-admin-recovery posture. |
| 2026-05-04 | automation/work-on-password-manager | 4 | Complete | [#886](https://github.com/carrtech-dev/ct-ops/pull/886) | `git diff --check`; `node --experimental-strip-types --test lib/db/schema/password-vault.contract.test.mjs`; `pnpm --filter web db:validate`; `pnpm --filter web type-check`; `pnpm --filter web test:unit`; `pnpm --filter web lint lib/db/schema/password-vault.contract.ts lib/db/schema/password-vault.contract.test.mjs` | Added a reusable Password Vault schema contract and unit tests that lock in planned table names, org scoping, membership/key-epoch constraints, audit actor columns, and the no-plaintext-secret expectation before schema implementation starts. |
| 2026-05-04 | automation/work-on-password-manager | 5 | Complete | [#895](https://github.com/carrtech-dev/ct-ops/pull/895) | `node --experimental-strip-types --test lib/db/schema/password-vault.contract.test.mjs`; `pnpm run db:validate`; `pnpm run type-check`; `pnpm run lint lib/db/schema/password-vault.ts lib/db/schema/password-vault.contract.test.mjs tests/e2e/fixtures/db.ts`; `git diff --check` | Added the Drizzle Password Vault schema and generated migrations, wired the tables into schema exports and E2E truncation, and filed issue `#894` for pre-existing Drizzle metadata drift that re-emits licence verifier column additions during generation. |
| 2026-05-04 | automation/work-on-password-manager | 13 | Complete | [#929](https://github.com/carrtech-dev/ct-ops/pull/929) | `node --experimental-strip-types --test apps/web/lib/password-vault/audit-api.test.mjs apps/web/lib/password-vault/api-policy.test.mjs`; `pnpm --filter web test:unit`; `pnpm --filter web type-check`; `pnpm --filter web lint lib/password-vault/audit-api.ts lib/password-vault/audit-api.test.mjs lib/password-vault/audit-routes.ts lib/password-vault/profile-routes.ts lib/password-vault/vault-routes.ts lib/password-vault/entry-routes.ts lib/password-vault/sharing-routes.ts lib/password-vault/api-policy.ts lib/password-vault/api-policy.test.mjs app/api/password-vault/unlock-audit/route.ts app/api/password-vault/vaults/[vaultId]/export-audit/route.ts app/api/password-vault/vaults/[vaultId]/entries/[entryId]/reveal-audit/route.ts app/api/password-vault/vaults/[vaultId]/entries/[entryId]/copy-audit/route.ts`; `pnpm --filter web db:validate`; `BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_SECRET=<local-test-secret> DATABASE_URL=<local-postgres-url> pnpm --filter web build`; `git diff --check` | Added audit coverage for Password Vault setup, unlock outcomes, CRUD, reveal/copy/export, sharing, revoke, role change, and key rotation without plaintext or ciphertext metadata. |
| 2026-05-04 | automation/work-on-password-manager | 8 | Complete | [#902](https://github.com/carrtech-dev/ct-ops/pull/902) | `node --experimental-strip-types --test lib/password-vault/api-policy.test.mjs`; `pnpm --filter web lint lib/password-vault/api-policy.ts lib/password-vault/api-policy.test.mjs`; `pnpm --filter web type-check`; `pnpm --filter web db:validate`; `pnpm --filter web build` with local auth and database env set; `git diff --check`; `pnpm --filter web test:unit` fails in pre-existing `lib/db/rls.test.mjs` Drizzle migration drift tracked by issue `#897` | Added the Password Vault API policy contract and tests for session, organisation, membership, role, origin, body-bound, and rate-limit expectations before route implementation. |
| 2026-05-04 | automation/work-on-password-manager | 6-7 | Complete | [#898](https://github.com/carrtech-dev/ct-ops/pull/898) | `node --experimental-strip-types --test apps/web/lib/password-vault/crypto.test.mjs`; `pnpm --dir apps/web db:validate`; `pnpm --dir apps/web type-check`; `pnpm --dir apps/web lint lib/password-vault/crypto.ts lib/password-vault/crypto.test.mjs`; `pnpm --dir apps/web test:unit` (fails: pre-existing `lib/db/rls.test.mjs` migration error tracked in issue `#897`); `BETTER_AUTH_URL=https://ct-ops.test DATABASE_URL=<local-postgres-url> pnpm --dir apps/web build` (still needs additional runtime env such as `BETTER_AUTH_SECRET`) | Added the browser crypto module and tests for KDF, private-key envelopes, payload envelopes, and wrapped vault keys; filed issue `#897` for the unrelated RLS migration failure uncovered during validation. |
| 2026-05-04 | automation/work-on-password-manager | 9 | Complete | [#905](https://github.com/carrtech-dev/ct-ops/pull/905) | `node --experimental-strip-types --test lib/password-vault/profile-api.test.mjs`; `node --experimental-strip-types --test lib/password-vault/api-policy.test.mjs lib/password-vault/crypto.test.mjs lib/password-vault/profile-api.test.mjs`; `pnpm --dir apps/web lint lib/password-vault/profile-api.ts lib/password-vault/profile-api.test.mjs lib/password-vault/profile-routes.ts app/api/password-vault/setup-status/route.ts app/api/password-vault/user-key/route.ts app/api/password-vault/unlock-metadata/route.ts`; `pnpm --dir apps/web type-check`; `pnpm --dir apps/web db:validate`; `BETTER_AUTH_URL=https://ct-ops.test BETTER_AUTH_SECRET=<local-test-secret> DATABASE_URL=<local-postgres-url> pnpm --dir apps/web build`; `git diff --check`; `pnpm --dir apps/web test:unit` fails only in pre-existing `lib/db/rls.test.mjs` migration drift tracked by issue `#897` | Added the setup/profile API endpoints for current-user setup status, one-time encrypted user-key profile persistence, and unlock metadata retrieval; payload validation rejects plaintext-shaped fields and enforces Argon2id floors. |
| 2026-05-04 | automation/work-on-password-manager | 10 | Complete | [#913](https://github.com/carrtech-dev/ct-ops/pull/913) | `node --experimental-strip-types --test lib/password-vault/api-policy.test.mjs lib/password-vault/crypto.test.mjs lib/password-vault/profile-api.test.mjs lib/password-vault/vault-api.test.mjs`; `pnpm --dir apps/web lint lib/password-vault/vault-api.ts lib/password-vault/vault-api.test.mjs lib/password-vault/vault-routes.ts app/api/password-vault/vaults/route.ts app/api/password-vault/vaults/[vaultId]/route.ts`; `pnpm --dir apps/web type-check`; `pnpm --dir apps/web db:validate`; `BETTER_AUTH_URL=https://ct-ops.test BETTER_AUTH_SECRET=<local-test-secret> DATABASE_URL=<local-postgres-url> pnpm --dir apps/web build`; `git diff --check`; `pnpm --dir apps/web test:unit` fails only in pre-existing `lib/db/rls.test.mjs` migration drift tracked by issue `#897` | Added vault CRUD API route handlers and encrypted-only API contract tests; create persists the active vault, initial key epoch, and owner membership in one scoped transaction. |
| 2026-05-04 | automation/work-on-password-manager | 11 | Complete | [#920](https://github.com/carrtech-dev/ct-ops/pull/920) | `node --experimental-strip-types --test lib/password-vault/api-policy.test.mjs lib/password-vault/crypto.test.mjs lib/password-vault/profile-api.test.mjs lib/password-vault/vault-api.test.mjs lib/password-vault/entry-api.test.mjs`; `pnpm --dir apps/web lint lib/password-vault/entry-api.ts lib/password-vault/entry-api.test.mjs lib/password-vault/entry-routes.ts app/api/password-vault/vaults/[vaultId]/entries/route.ts app/api/password-vault/vaults/[vaultId]/entries/[entryId]/route.ts`; `pnpm --dir apps/web type-check`; `pnpm --dir apps/web db:validate`; `pnpm --dir apps/web test:unit`; `BETTER_AUTH_URL=https://ct-ops.test BETTER_AUTH_SECRET=<local-test-secret> DATABASE_URL=<local-postgres-url> pnpm --dir apps/web build`; `git diff --check` | Added entry CRUD route handlers and encrypted-only entry API contract tests; create/list/get/update/delete require active vault membership and never accept plaintext-shaped entry fields. |
| 2026-05-04 | automation/work-on-password-manager | 12 | Complete | [#925](https://github.com/carrtech-dev/ct-ops/pull/925) | `node --experimental-strip-types --test lib/password-vault/sharing-api.test.mjs lib/password-vault/api-policy.test.mjs lib/password-vault/vault-api.test.mjs lib/password-vault/entry-api.test.mjs`; `pnpm --filter web test:unit`; `pnpm --filter web type-check`; `pnpm --filter web lint`; `pnpm --filter web db:validate`; `BETTER_AUTH_URL=<local-url> BETTER_AUTH_SECRET=<local-test-secret> DATABASE_URL=<local-postgres-url> pnpm --filter web build`; `git diff --check` | Added sharing and key-rotation APIs with encrypted-only member/key-wrap payloads, manager role gates, owner-safety checks, share rate limiting, member eligibility checks, and key-rotation idempotency persistence. |
| 2026-05-04 | automation/work-on-password-manager | 14 | Complete | [#938](https://github.com/carrtech-dev/ct-ops/pull/938) | `node --experimental-strip-types --test lib/password-vault/route-shell.test.mjs`; `pnpm --filter web lint lib/password-vault/route-shell.ts lib/password-vault/route-shell.test.mjs app/(dashboard)/password-vault/page.tsx app/(dashboard)/password-vault/password-vault-client.tsx components/shared/sidebar.tsx components/shared/command-palette/providers.tsx components/shared/command-palette/command-palette.tsx`; `pnpm --filter web type-check`; `pnpm --filter web db:validate`; `pnpm --filter web test:unit`; `BETTER_AUTH_URL=https://ct-ops.test BETTER_AUTH_SECRET=<local-test-secret> DATABASE_URL=<local-postgres-url> pnpm --filter web build`; `git diff --check` | Added the dashboard route shell and navigation wiring; setup/unlock/create-entry actions are intentionally disabled until tasks 15 and 16 implement the browser crypto workflows. |
