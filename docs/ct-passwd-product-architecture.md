# CT-Passwd Product Architecture

This document defines the CT-OPS-side product architecture for CT-Passwd. It
describes the product boundary, browser and service trust relationships,
expected nginx routing, and the threat model that downstream implementation
work must satisfy.

This is the CT-OPS source of truth until the private `ct-passwd` repository is
bootstrapped and can carry product-local implementation detail.

## Goals

- Keep CT-Passwd deployable in air-gapped customer environments.
- Keep CT-OPS as the only visible product shell, identity provider, licence
  gate, and reverse-proxy owner.
- Preserve a zero-knowledge posture where CT-Passwd servers never receive
  plaintext secrets or user unlock material.
- Allow future multi-user shared vaults without weakening the baseline
  cryptographic model.

## Product Boundary

CT-OPS owns:

- Customer licensing and CT-Passwd entitlement state.
- Product discovery, navigation visibility, and launch entry points.
- Plugin instance registration and trust material for CT-Passwd.
- Reverse-proxy ownership, TLS termination, and customer installer updates.
- Shared operator-facing deployment, health, and support documentation.

CT-Passwd owns:

- Password-manager UI, forms, validation, and workflows.
- Browser-side encryption, decryption, key generation, and unlock UX.
- Encrypted vault, entry, membership, session, and audit APIs.
- Product-local database schema and operational data.

CT-Passwd must not:

- Query the CT-OPS database directly.
- Reuse CT-OPS server actions or import CT-OPS private modules as a shortcut.
- Expose its UI in CT-OPS unless a valid CT-Passwd entitlement exists.
- Depend on CT-OPS to render password-manager forms from JSON or to handle
  plaintext secrets.

## Deployment Shape

The expected first customer deployment is:

```text
ct-ops-web
ct-ops-ingest
ct-ops-db
ct-ops-nginx
ct-passwd-api
ct-passwd-web
ct-passwd-db
```

CT-Passwd is released as a separate product repository but deployed as part of
the same customer installation footprint. CT-OPS remains the customer-facing
entry point for setup, licensing, and upgrade orchestration.

## Routing Model

The default routing model is a dedicated CT-Passwd hostname behind the CT-OPS
nginx reverse proxy:

```text
https://passwd.customer.local -> ct-ops nginx -> ct-passwd-web -> ct-passwd-api
```

Requirements:

- CT-OPS generates and owns the nginx configuration that publishes CT-Passwd.
- TLS is terminated at the CT-OPS nginx layer unless a future deployment profile
  requires passthrough.
- CT-Passwd hostname routing is the default because it provides cleaner cookie
  isolation, CSP policy, and operational separation.
- Path routing such as `https://ct-ops.customer.local/passwd` is a fallback only
  for customers that cannot create a second hostname.
- Direct exposure of CT-Passwd containers without the CT-OPS reverse proxy is
  unsupported.

Routing consequences:

- CT-Passwd must assume its origin may be a dedicated hostname or a routed path,
  but the preferred behaviour, cookies, and CSP should be designed around the
  dedicated-hostname case.
- All published customer docs and installer defaults should present dedicated
  hostname routing first and describe path routing as a compromise mode.

## Identity And Launch Flow

CT-OPS remains the identity provider and authorization source for CT-Passwd
users.

High-level flow:

1. A licensed CT-OPS user clicks the CT-Passwd entry point.
2. CT-OPS verifies that the organisation has an active CT-Passwd entitlement and
   that the current user is allowed to launch the plugin.
3. CT-OPS creates a short-lived signed launch assertion scoped to the paired
   CT-Passwd instance, user, organisation, and nonce/jti.
4. The browser is redirected to CT-Passwd with that assertion.
5. CT-Passwd validates the assertion against pinned CT-OPS trust material and
   creates a short-lived plugin-local session cookie.
6. The user separately unlocks CT-Passwd inside the browser using their
   CT-Passwd unlock password.

Launch assertions must include:

- issuer
- audience
- product identifier
- organisation identifier
- user identifier
- expiry
- jti or nonce

CT-Passwd must reject assertions with the wrong issuer, audience, organisation,
user, product, expiry, or replayed nonce.

## Zero-Knowledge Model

CT-Passwd uses browser-side cryptography for all secret-bearing data.

Secret fields that must be encrypted in the browser:

- usernames
- passwords
- URLs
- notes
- TOTP seeds
- custom fields
- attachment metadata
- other secret-bearing metadata

Plaintext that may remain server-visible:

- entry title, with an explicit UI warning not to store secrets there
- vault name
- object identifiers
- timestamps
- audit event type
- non-secret operational metadata

Required cryptographic properties:

- Argon2id for unlock-password key derivation.
- Authenticated encryption using AES-256-GCM or XChaCha20-Poly1305.
- Unique nonce generation per encryption operation.
- Random per-entry or per-entry-version data encryption keys.
- Per-vault vault keys wrapped separately for each authorized user.
- Encrypted private keys stored on the server only after local encryption with a
  key derived from the CT-Passwd unlock password.

The server must never receive:

- unlock passwords
- derived unlock keys
- unencrypted private keys
- vault keys
- entry data-encryption keys
- plaintext secret fields

## Shared Vault Model

Shared access is required for team password management while preserving the
zero-knowledge boundary.

- Each user has a browser-generated public/private encryption key pair.
- The private key is encrypted locally with a key derived from the unlock
  password before upload.
- Each vault has a vault key.
- The vault key is wrapped separately for every authorized user.
- Entry data-encryption keys are wrapped by the vault key.
- Adding a user requires an already-authorized unlocked user to wrap the vault
  key for the new member's public key.
- Removing a user requires rotating the vault key for future access.

This design protects the server from plaintext exposure, but it does not claim
to revoke secrets already seen or copied by a removed user.

## Licence Gating And Discoverability

CT-Passwd must be invisible in CT-OPS unless an active CT-Passwd entitlement
exists for the organisation.

Without an entitlement, CT-OPS must not show:

- navigation items
- routes
- settings cards
- search results
- teaser text
- setup hints
- empty states that reveal CT-Passwd exists

This is stricter than a disabled button model. CT-Passwd should behave as if it
is not installed from the perspective of an unlicensed user.

## Audit Boundary

CT-Passwd owns secret-related audit events and storage. CT-OPS may display
high-level health or integration status, but detailed password-manager audit
events belong to CT-Passwd.

Required CT-Passwd audit events:

- create
- update
- delete
- view
- copy
- export
- failed unlock
- successful unlock
- permission changes
- admin actions
- key rotation
- backup and restore actions

Audit logs must never contain secret values.

## Threat Model

### Primary assets

- User unlock passwords.
- User private keys.
- Vault keys and wrapped key material.
- Encrypted entry payloads.
- Audit history.
- CT-OPS to CT-Passwd trust material.

### Trust boundaries

- Browser to CT-OPS.
- Browser to CT-Passwd.
- CT-OPS to CT-Passwd service boundary.
- CT-Passwd application to CT-Passwd database.
- CT-OPS nginx to customer network.

### Assumed attackers

- An external network attacker able to replay or tamper with requests.
- A customer-side operator with database access to CT-Passwd storage.
- A compromised CT-Passwd server process.
- A compromised CT-OPS server process.
- A malicious or removed vault member.
- A user endpoint compromised after unlock.

### Required mitigations

For network and replay risk:

- Signed launch assertions with expiry, audience binding, and replay protection.
- HTTPS everywhere inside the supported deployment shape.
- Bounded clock-skew windows and nonce storage for anti-replay checks.

For database compromise:

- Only encrypted blobs and wrapped keys are stored for secret data.
- Server-side logs, backups, and diagnostics must avoid secret values.
- Schema and API design must avoid accidental plaintext copies in derived tables
  or audit rows.

For CT-Passwd server compromise:

- The server must still be unable to read stored secrets without browser-held
  unlock material.
- Sessions, cookies, CSRF controls, and audit events must limit abuse and make
  actions attributable.

For CT-OPS compromise:

- CT-OPS compromise must not immediately reveal stored secret plaintext, though
  it can enable fraudulent launch assertions or entitlement abuse.
- Future security review must separately assess the blast radius of a CT-OPS
  signing-key compromise.

For malicious insiders or removed members:

- Authorization must be enforced on every vault, entry, and membership action.
- Vault key rotation is required after member removal for future protection.
- Product docs must explicitly state that historical viewing or copying cannot
  be cryptographically undone.

For compromised user browsers:

- Unlock-derived material and decrypted secrets should live only in browser
  memory for the active unlocked session.
- CT-Passwd should provide lock and timeout controls to reduce exposure.

### Out of scope for MVP

- Admin recovery of lost unlock passwords.
- Breaking zero-knowledge guarantees to enable server-side search over secret
  fields.
- Direct CT-Passwd access without CT-OPS-issued launch assertions.

## Implementation Consequences

Downstream implementation work in CT-OPS and `ct-passwd` should preserve these
constraints:

- CT-OPS work should focus on entitlement gating, plugin trust registration,
  launch assertion issuance, and nginx/deployment orchestration.
- CT-Passwd work should own its UI, crypto, API, database, sessions, audit, and
  vault authorization rules.
- Shared integration contracts should be explicit, signed, replay-resistant, and
  versioned.
