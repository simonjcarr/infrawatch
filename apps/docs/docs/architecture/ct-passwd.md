# CT-Passwd Architecture

CT-Passwd is the CarrTech password-manager product that plugs into CT-Ops while
remaining separately deployed and separately released.

CT-Ops stays responsible for identity, licensing, and customer-facing ingress.
CT-Passwd owns the password-manager UI, browser-side cryptography, encrypted
data APIs, and audit trail.

## Product Boundary

CT-Ops owns:

- CT-Passwd entitlement checks and visibility.
- Plugin registration and trust material.
- Launch entry points and signed launch assertions.
- Nginx reverse-proxy publishing and installer changes.

CT-Passwd owns:

- Password-manager forms and workflows.
- Browser-side encryption and decryption.
- Vault, entry, membership, session, and audit APIs.
- Product-local database storage.

CT-Passwd is intentionally not a standalone customer product. It depends on
CT-Ops for user identity, organisation context, and product access control.

## Routing Model

The default deployment uses a dedicated hostname behind the CT-Ops nginx
reverse proxy:

```text
https://passwd.customer.local -> ct-ops nginx -> ct-passwd-web -> ct-passwd-api
```

Dedicated hostname routing is the default because it gives cleaner cookie
isolation and security-policy boundaries. Path routing such as
`https://ct-ops.customer.local/passwd` is supported only as a documented
fallback when a customer cannot provision a second hostname.

CT-Passwd is not meant to be exposed directly on the customer network outside
the CT-Ops reverse-proxy path.

## Identity And Sessions

Users enter CT-Passwd from CT-Ops. CT-Ops issues a short-lived signed launch
assertion that identifies the paired plugin instance, organisation, user, and
expiry window. CT-Passwd validates the assertion and then creates a short-lived
plugin-local session.

Users must still unlock CT-Passwd separately with a CT-Passwd unlock password.
That unlock step is distinct from CT-Ops authentication.

## Zero-Knowledge Encryption Model

CT-Passwd uses browser-side cryptography so the server stores encrypted blobs
and wrapped keys rather than plaintext secrets.

Encrypted in the browser:

- usernames
- passwords
- URLs
- notes
- TOTP seeds
- custom fields
- attachment metadata

Plaintext allowed on the server:

- entry title
- vault name
- object identifiers
- timestamps
- audit event types

The server must never receive unlock passwords, derived unlock keys, plaintext
secret fields, unencrypted private keys, vault keys, or entry data-encryption
keys.

## Shared Vaults

Shared vaults use per-user public keys and per-vault vault keys.

- Each user has a browser-generated public/private key pair.
- The private key is encrypted locally before upload.
- Each vault key is wrapped separately for every authorized user.
- Removing a member requires vault-key rotation for future access.

This protects the server boundary, but it does not claim to revoke secrets a
removed user has already seen or copied.

## Threat Model Summary

CT-Passwd is designed to reduce damage from:

- database compromise, because stored secret data remains encrypted
- CT-Passwd server compromise, because the server should still lack plaintext
  secrets and unlock material
- replay or forged launches, through signed short-lived launch assertions with
  nonce or `jti` checks
- malicious insiders or removed members, through per-object authorization and
  vault-key rotation

The MVP does not include admin recovery of lost unlock passwords.

## Further Reading

Implementation-tracking detail remains in the repository-level planning and
architecture documents under the top-level `docs/` directory.
