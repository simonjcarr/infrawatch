# CT Ops Password Vault Architecture and Threat Model

Status: Accepted

Date: 2026-05-04

## Purpose

This document defines the first implementation architecture for the built-in CT
Ops Password Vault. It records the security boundaries, trust assumptions,
recovery posture, cryptographic hierarchy, and abuse-resistance expectations
that future schema, API, UI, and test work must follow.

Password Vault is first-party CT Ops functionality. It ships in this
repository, uses CT Ops authentication and organisation scoping, and follows CT
Ops release, audit, and validation standards. It is not an external plugin,
separate service, or separate repository.

## Product Boundary

Password Vault is responsible for:

- browser-side key derivation, encryption, decryption, and local unlock state;
- encrypted vault, entry, and sharing workflows inside `apps/web`;
- organisation-scoped vault APIs under `/api/password-vault/...`;
- per-user wrapped vault keys for shared-vault access;
- audit events for security-sensitive vault actions without secret leakage.

Password Vault is not responsible for:

- third-party password-manager import in the MVP;
- browser extensions, attachments, breach checks, or emergency access;
- admin recovery, organisation recovery, or any server-held escrowed unlock
  material;
- server-side plaintext search or indexing over secret-bearing fields.

## Security Goals

The MVP must satisfy these goals:

- CT Ops servers, databases, logs, backups, and administrators do not receive
  plaintext vault secrets or unlock passwords during normal operation.
- Backend authorization, organisation scoping, role checks, payload bounds,
  trusted-origin checks, and rate limits are enforced server-side.
- Vault sharing works across multiple CT Ops users without exposing a shared
  plaintext vault key to the backend.
- Removal of a vault member blocks future backend access and triggers a key
  rotation workflow for future secrecy.
- Audit logs capture sensitive operations without recording plaintext values,
  ciphertext previews, or metadata that would materially weaken secrecy.

## Non-Goals

The MVP does not protect against every class of compromise. It does not provide:

- recovery after a user forgets the unlock password and no other member can
  re-share access;
- cryptographic clawback of secrets a user already revealed, copied, exported,
  or stored outside the vault;
- protection from a malicious CT Ops web build served by a compromised trusted
  deployment pipeline or application host;
- encrypted full-text server search with no leakage tradeoff.

## Trust Model

### Trusted components

- The user's browser runtime after it loads a legitimate CT Ops build.
- WebCrypto primitives in supported browsers.
- `libsodium-wrappers-sumo` for Argon2id derivation and supporting key
  operations performed in the browser.
- CT Ops session authentication for identifying the acting user and
  organisation.

### Semi-trusted components

- The CT Ops backend, database, and logs are trusted for authorization,
  durability, and audit integrity, but must be treated as untrusted for vault
  plaintext confidentiality.
- Other authorised vault members are trusted only to the extent implied by
  vault sharing. They can reveal or exfiltrate secrets they can decrypt.

### Explicitly untrusted for confidentiality

- Database snapshots and replicas.
- Operational logs and telemetry.
- Backup media.
- Support exports and diagnostic bundles.
- Network observers outside the user's browser TLS session.

## Zero-Knowledge Scope and Limits

Password Vault is designed as zero-knowledge for secret-bearing vault content,
not as a system where CT Ops can prove it never influences client code.

The server must never receive plaintext values for:

- vault names if treated as sensitive display data;
- entry titles, usernames, passwords, URLs, notes, TOTP seeds, tags, and
  custom fields;
- unlock passwords, derived unlock keys, vault keys, entry keys, or private
  keys.

The server may still know or enforce:

- CT Ops user identity, session state, organisation membership, and vault
  membership;
- opaque vault, entry, and key-epoch identifiers;
- envelope version, size, timestamps, action type, and audit actor;
- whether a user attempted setup, unlock audit, create, update, delete, share,
  revoke, reveal, or copy actions.

This is therefore not a claim that CT Ops operators can never influence
confidentiality. A compromised CT Ops web server or build pipeline could serve
malicious JavaScript that captures unlock material or plaintext after decryption
in the browser. Public and operator-facing documentation must state this
residual risk plainly.

## Recovery Posture

The MVP has no admin recovery and no organisation-level escrow.

- Unlock passwords never leave the browser.
- CT Ops does not store a decryptable copy of a user's private key.
- CT Ops support staff and super admins cannot reset a vault into a readable
  state.
- If a user loses unlock credentials and no already-authorised unlocked member
  can re-share access, the encrypted data is unrecoverable.

This tradeoff is deliberate. It reduces backend compromise impact by refusing to
create a server-side recovery secret that would undermine the zero-knowledge
goal.

## Cryptographic Architecture

### Primitive selection

- Password-based key derivation: Argon2id in the browser through
  `libsodium-wrappers-sumo`.
- Symmetric encryption: AES-256-GCM through WebCrypto.
- Shared-key wrapping: ECDH + HKDF + AES-GCM through WebCrypto.
- Randomness: browser cryptographic RNG only.

Default Argon2id parameters for the MVP:

- memory: 64 MiB
- iterations: 3
- parallelism: 1

Implementations may increase these values, but must not go below the current
OWASP Argon2id floor without updating the design and rationale.

### Key hierarchy

1. The user chooses an unlock password locally in the browser.
2. Argon2id derives an unlock key from that password and a per-user salt.
3. The unlock key encrypts the user's private key envelope locally.
4. The user's public key is stored server-side for sharing operations.
5. Each vault has a randomly generated vault key created in the browser.
6. Vault display metadata and entry payloads are encrypted locally with keys
   derived from or wrapped by the vault key.
7. For each authorised member, the vault key is wrapped to that user's public
   key and stored as a per-user membership envelope.
8. Each vault key epoch records the currently active wrapped-key generation for
   membership and rotation purposes.

The backend stores encrypted envelopes, public keys, KDF metadata, and version
information, but never plaintext secret material.

## Data Classification

Secret-bearing fields must stay encrypted end-to-end between the browser and
storage:

- vault names and display metadata if they reveal secret context;
- entry titles, usernames, passwords, URLs, notes, TOTP seeds, tags, folders,
  and custom fields;
- vault keys, entry keys, private keys, and wrapped-secret material.

Allowed server-visible metadata is intentionally narrow:

- opaque identifiers;
- ownership and membership references;
- organisation scope;
- envelope versions and sizes;
- created/updated/deleted timestamps;
- audit actor and action type;
- role and rotation state.

No implementation may add plaintext indexing or search aids for secret-bearing
fields without a separate documented leakage review.

## Backend Security Responsibilities

Client-side crypto does not weaken backend requirements. Every Password Vault
route must still:

- derive the acting CT Ops user and organisation from the server-side session;
- enforce organisation scope and vault membership on every read and mutation;
- validate request shape, type, size, version, and allowed values with Zod;
- reject over-large payloads and unknown envelope versions before persistence;
- use trusted mutation-origin checks for state-changing operations;
- apply server-side rate limits to setup, unlock audit, share, export, and
  other sensitive paths;
- ensure create/update/delete and sharing operations are idempotent where a
  retry could otherwise duplicate work;
- avoid logging raw request bodies, decrypted values, or ciphertext previews;
- write audit records that describe actions without revealing secret contents.

Frontend checks exist for user experience only. They are not a security
boundary.

## Threat Model

### In scope

- database theft or snapshot exposure;
- log and telemetry exposure;
- backup compromise;
- cross-organisation or cross-vault authorization bugs;
- over-broad API responses that leak secret-bearing payloads or metadata;
- malformed, oversized, replayed, or duplicate mutation requests;
- member revocation and stale wrapped-key handling;
- ciphertext tampering and nonce misuse;
- plaintext leakage through analytics, error handling, or support tooling.

### Out of scope

- endpoint compromise after a user reveals or copies a secret;
- physical observation of a user's screen or clipboard;
- malicious browser extensions on the client endpoint;
- a trusted CT Ops deployment intentionally serving hostile JavaScript;
- future post-quantum migration requirements.

### Key threat assumptions and mitigations

- Backend or database compromise:
  Encrypted vault payloads, wrapped vault keys, and encrypted private-key
  envelopes should resist plaintext disclosure.
- Broken authorization:
  Server-side organisation and membership checks must gate every route, even if
  the client already filtered the UI.
- Abuse of mutation paths:
  Rate limits, payload bounds, trusted-origin checks, and idempotent mutation
  handling must reduce brute force, replay, and accidental duplicate actions.
- Member removal:
  Backend access is blocked immediately and the vault enters a new key epoch so
  future updates can exclude the removed member.
- Ciphertext tampering:
  AES-GCM authentication failure must reject modified envelopes without
  fallback.
- Malicious server-delivered JavaScript:
  This remains a residual risk and must be documented rather than hand-waved
  away.

## Multi-User Sharing Model

- A vault belongs to one CT Ops organisation.
- Access is granted to explicit vault members only.
- Each member stores an independent wrapped copy of the current vault key for
  the active key epoch.
- Role changes and revocation are backend-enforced.
- After member removal, an unlocked authorised owner or admin must rotate the
  vault key epoch so future access excludes the removed member.

This design accepts that users who already decrypted secrets may retain copies.
The system prevents future backend-authorised access; it cannot erase data a
human already saw.

## Standards Alignment

This design follows the current baseline named in the implementation plan:

- NIST SP 800-63B-4 for password and authenticator guidance;
- NIST SP 800-57 Part 1 Rev. 5 for key-management lifecycle expectations;
- NIST SP 800-38D for AES-GCM authenticated-encryption constraints;
- OWASP Password Storage Cheat Sheet for Argon2id minimum posture;
- OWASP Cryptographic Storage Cheat Sheet for envelope encryption and key
  management practices.

If implementation work requires a different primitive, lower work factor, or
recovery model, this document must be updated in the same pull request as the
code change.

## Implementation Constraints for Follow-On Tasks

Follow-on tasks must preserve these decisions:

- Password Vault remains inside `apps/web`; do not extract it into a plugin or
  separate service for the MVP.
- Route handlers under `/api/password-vault/...` remain the backend API shape.
- No server route may accept plaintext secret fields for convenience.
- No admin recovery, escrow, or organisation master key may be introduced in
  the MVP.
- Public product docs must describe the malicious-JavaScript residual risk and
  no-recovery consequence plainly.
- Schema, unit, and E2E coverage must verify ciphertext-only transport and
  backend authorization boundaries.
