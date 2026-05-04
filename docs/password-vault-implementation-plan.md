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
| 4 | Add schema test expectations first | 2 | In progress | automation/work-on-password-manager @ 2026-05-04T12:17:59Z |  | Add failing or validation-focused tests/checks for the vault tables, organisation scoping, membership constraints, key epochs, and audit relationships. |
| 5 | Add vault schema and migration | 4 | Not started |  |  | Add Drizzle schema, migration, exports, and E2E truncate entries for user keys, vaults, key epochs, members, entries, and audit references. |
| 6 | Add browser crypto tests first | 2 | Not started |  |  | Add tests for Argon2id parameter serialization, unlock failure, AES-GCM tamper rejection, nonce uniqueness, key wrapping, and no plaintext serialization. |
| 7 | Implement browser crypto package | 6 | Not started |  |  | Add browser-only crypto helpers for KDF, random bytes, AEAD envelopes, user private-key encryption, vault-key wrapping, and entry payload encryption. |
| 8 | Add API authorization and validation tests first | 5 | Not started |  |  | Add tests for session required, org isolation, vault membership, role checks, trusted origin, payload size bounds, and rate limits. |
| 9 | Implement vault setup/profile API | 7,8 | Not started |  |  | Add setup-status, encrypted user-key material, public key, KDF params, and unlock-metadata endpoints. |
| 10 | Implement vault CRUD API | 9 | Not started |  |  | Add create/list/update/delete vault endpoints using encrypted display payloads and backend membership enforcement. |
| 11 | Implement entry CRUD API | 10 | Not started |  |  | Add create/list/update/delete entry endpoints that accept ciphertext envelopes only and reject plaintext-shaped secret fields. |
| 12 | Implement sharing and key-rotation API | 10 | Not started |  |  | Add member invite/add/remove/role-change flows, per-user wrapped vault keys, key epoch rotation after removal, and idempotent mutation handling. |
| 13 | Add audit event coverage | 11,12 | Not started |  |  | Emit audit events for setup, unlock success/failure, create, update, delete, reveal, copy, export, share, revoke, role change, and key rotation without secret metadata. |
| 14 | Add Password Vault route shell | 9 | Not started |  |  | Add `/password-vault`, sidebar item, command palette item, locked state, first-use state, empty state, and stable `data-testid` attributes. |
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
