# CT Ops Plugin Identity Broker Design

Status: Accepted

Date: 2026-05-04

Related:

- `docs/ct-ops-licensing-and-ct-cve-product-decision.md`
- `docs/ct-ops-ct-cve-api-contract.md`
- `docs/ct-cve-migration-plan.md`

## Context

CT-CVE and future external CT Ops plugins need CT Ops to remain the
installation entry point, identity provider, and installation authority without
forcing each plugin to run its own user database. The existing product
decision record and CT-CVE API contract already define that direction, but
they stop short of a concrete shared broker design for pairing, trust storage,
launch assertions, session revocation, and backend authorization checks.

That missing broker detail now blocks multiple follow-on tasks:

- CT-CVE cannot replace its placeholder GUI subscription/auth status with a
  real CT Ops-launched flow.
- Future external plugins need one repeatable model instead of product-by-
  product authentication inventions.

## Goals

- Keep CT Ops as the only customer user-login system.
- Prevent plugins from trusting a copied or forged CT Ops database by requiring
  CT Ops-signed assertions and pinned installation trust.
- Support CT-CVE and future first-party plugins with one broker model.
- Keep plugin-specific forms, workflows, and operational data in each plugin.
- Ensure backend authorization decisions are enforceable even when the frontend
  is bypassed.
- Make plugin-instance disablement, user removal, and role changes revoke
  access on a bounded timeline.

## Non-Goals

- Plugin licence storage, CT Portal request-token verification, or subscription
  status semantics. Those belong to the next entitlement phase.
- Plugin-specific RBAC schemas beyond the common CT Ops identity claims.
- A generic CT Ops form-rendering system for plugin configuration.
- Cross-plugin single sign-on beyond CT Ops-launched plugin entry.

## Core Components

| Component | Owned by | Responsibility |
| --- | --- | --- |
| Installation identity | CT Ops | Stable installation identifier plus signing keys for plugin launch assertions. |
| Plugin instance registry | CT Ops | Tracks paired plugin instances, allowed origins/URLs, product, installation scope, keys, and revocation state. |
| Pairing endpoint | Plugin + CT Ops | Exchanges trust material and registers an instance relationship. |
| Launch service | CT Ops | Issues short-lived signed user assertions for a specific plugin instance. |
| Plugin verifier | Plugin | Verifies CT Ops assertions against pinned CT Ops trust material. |
| Plugin-local session | Plugin | Short-lived session cookie created only after a verified launch. |
| Session status check | CT Ops | Signed service-to-service endpoint for plugins to recheck user/plugin session state on sensitive paths. |

## Installation Identity

Each CT Ops installation must have a stable installation identity and an
asymmetric signing keyset dedicated to plugin assertions.

Required fields:

- `ctOpsInstallationId`: immutable installation identifier, generated once and
  persisted outside ephemeral containers.
- `issuer`: stable issuer string derived from the installation identity and CT
  Ops base URL.
- `activeKid`: current signing key identifier.
- `nextKid`: optional staged key for rotation overlap.

Key rules:

- Use asymmetric signing, not shared browser secrets. Ed25519 is preferred for
  compact assertions and easy plugin-side verification.
- Private keys stay only inside CT Ops trusted server storage.
- Public keys are exposed to paired plugins during registration and rotation.
- Key rotation must support overlap so plugins can trust both the active and
  next key during a planned rollout.
- Old keys are retired only after every paired plugin has had a chance to fetch
  the replacement trust material.

## Plugin Instance Registry

CT Ops stores one registry row per paired plugin instance.

Required registry fields:

- `pluginInstanceId`
- `product`, for example `ct-cve`
- `ctOpsInstallationId`
- `displayName`
- `launchUrl`
- `allowedOrigins`
- `launchMode`: `redirect`, `iframe`, or `proxy`
- `pluginPublicKeys` or equivalent verification material
- `pluginServiceTokenIds`
- `status`: `active`, `disabled`, `revoked`, or `error`
- `revokedAt` and `revocationReason`
- `lastPairedAt`
- `lastSeenAt`

Registry invariants:

- Every launch target must be explicitly registered; CT Ops must never redirect
  users to an arbitrary plugin URL.
- The `product` claim and the registered plugin instance must agree.
- A plugin instance belongs to exactly one CT Ops installation scope.
- Revoked or disabled instances cannot receive fresh user assertions.
- Trust material changes are auditable and require org-admin or super-admin
  authority.

## Pairing And Trust Exchange

Pairing creates the trust relationship between one CT Ops installation and one
plugin instance.

Minimum pairing flow:

1. An administrator creates or starts plugin registration inside CT Ops.
2. CT Ops generates a one-time pairing challenge bound to the installation,
   product, and intended plugin origin.
3. The plugin receives the challenge through a plugin-owned pairing endpoint and
   returns its `pluginInstanceId`, product identifier, public verification key,
   canonical launch URL, and allowed browser origins.
4. CT Ops validates that the response matches the intended product and origin,
   then stores the plugin instance row.
5. The plugin stores the CT Ops `ctOpsInstallationId`, `issuer`, allowed CT Ops
   origin, and active public key set.

Pairing rules:

- Pairing challenges must be single use, short lived, and logged.
- CT Ops must reject a plugin response whose product or origin does not match
  the admin-approved target.
- Plugins must pin the CT Ops installation identity and reject assertions from
  any other issuer, even if usernames and installation IDs look plausible.
- Re-pairing rotates trust material but must preserve an auditable history.

## Launch Assertions

CT Ops launches a plugin by minting a compact signed assertion for one user,
one installation, one plugin instance, and one product.

Format:

- Signed JWT/JWS using the installation signing key.
- Maximum lifetime: 60 to 120 seconds.
- Single use through a unique `jti`.

Required claims:

| Claim | Meaning |
| --- | --- |
| `iss` | CT Ops issuer for the paired installation. |
| `aud` | Exact `pluginInstanceId`. |
| `sub` | CT Ops user identifier. |
| `ctOpsInstallationId` | CT Ops installation identifier. |
| `instanceSlug` | Optional human-readable diagnostics only. |
| `product` | Plugin product identifier such as `ct-cve`. |
| `roles` | CT Ops roles available to the plugin. |
| `permissions` | Optional derived permissions for plugin launch decisions. |
| `sid` | CT Ops session identifier or equivalent session binding. |
| `jti` | Unique assertion identifier for replay rejection. |
| `iat` / `nbf` / `exp` | Standard issuance and expiry timestamps. |

Assertion rules:

- Assertions must not contain secrets, licence keys, API tokens, plugin config,
  customer data, product-owned credentials, or other sensitive payloads.
- CT Ops issues assertions only after backend checks confirm the user session is
  active, the user still belongs to the installation, seat admission has not
  blocked the user, and the plugin instance is active for that product.
- Assertions are audience-bound to one plugin instance and cannot be reused for
  another plugin or another installation.
- Assertions are delivered by redirect, iframe bootstrap, or CT Ops-hosted
  proxy launch, but they are never written to logs or durable analytics.

## Launch Modes

The broker supports three UI launch modes:

- `redirect`: preferred default. CT Ops sends the browser to the registered
  plugin URL with a one-time assertion exchange.
- `iframe`: allowed for tightly bounded plugin shells. CT Ops only frames the
  registered origin, and the plugin must restrict `frame-ancestors` to the
  paired CT Ops origin where practical.
- `proxy`: fallback for same-origin shells that cannot expose the plugin origin
  directly. The proxy may forward the assertion server-side but must not become
  a generic plugin HTML renderer or configuration owner.

Regardless of launch mode, plugin-owned HTML, forms, validation, and workflow
handlers stay inside the plugin.

## Plugin Verification And Local Session

After launch, the plugin verifies the assertion before creating a local session.

Verification requirements:

- Check signature against the pinned CT Ops public key set.
- Check `iss`, `aud`, `product`, `ctOpsInstallationId`, `exp`, and `jti`.
- Reject replayed `jti` values during the assertion lifetime.
- Reject assertions for disabled or revoked plugin instances.

Plugin-local session rules:

- Create a plugin-local session only after a successful assertion verification.
- Use `HttpOnly`, `Secure`, and the narrowest viable `SameSite` mode.
- Prefer `SameSite=Lax` for redirect mode. Use `SameSite=None` only when iframe
  embedding genuinely requires it, plus CSRF protections on plugin mutations.
- Keep plugin sessions short lived. Default policy is a 15-minute idle timeout
  and a bounded absolute lifetime; higher-risk plugins may shorten further.
- Store the source `jti`, user ID, installation ID, product, and plugin instance ID on
  the session row so later checks can invalidate the session precisely.

## Revocation And Session Status

Revocation has to cover more than assertion expiry. The broker therefore uses
three layers:

1. CT Ops stops issuing new assertions immediately when the user loses access,
   the installation mapping changes, or the plugin instance is disabled.
2. Plugins keep local sessions short lived so stale access naturally expires on
   a bounded timeline.
3. Plugins can call a CT Ops session-status endpoint on sensitive or periodic
   paths to confirm the session is still valid.

The broker should provide a plugin-auth status endpoint, separate from future
licence status:

```text
POST /api/plugins/v1/session-status
```

Request body:

```json
{
  "pluginInstanceId": "plugin_inst_123",
  "product": "ct-cve",
  "ctOpsInstallationId": "ctops_inst_123",
  "userId": "user_123",
  "sid": "sess_123"
}
```

Response shape:

```json
{
  "active": true,
  "reason": "ok",
  "userStillAuthorized": true,
  "pluginInstanceActive": true,
  "installationMatch": true
}
```

Rules:

- The endpoint uses the existing signed service-token pattern, not browser
  cookies or launch assertions.
- Plugins should call it when creating a long-lived local session, before
  sensitive admin actions, and during periodic session refresh.
- A negative response forces the plugin to clear its local session and redirect
  the user back to CT Ops for a fresh launch or an access-denied state.

## Backend Authorization Checks

CT Ops backend checks before issuing a launch assertion:

- Authenticated CT Ops user session exists and is not revoked.
- User belongs to the requested installation.
- User is still admitted under CT Ops seat rules.
- Plugin instance is active, paired, and registered for the requested product
  and installation.
- The launch route is authorized for the user role.

Plugin backend checks after launch:

- Every plugin API request uses the verified plugin-local session or a fresh
  assertion exchange.
- Plugin authorization is derived from CT Ops claims plus plugin-owned object
  rules; the browser UI is never the authority.
- High-risk plugin actions may require a fresh launch assertion or a positive
  CT Ops session-status check.
- Service-to-service APIs such as health, inventory, finding, or future
  subscription-status endpoints continue to use scoped signed service tokens,
  not browser assertions.

## Product-Specific Constraints

### CT-CVE

- CT-CVE uses the broker only for operator identity and installation scope.
- CT-CVE still owns feed credentials, source configuration, and vulnerability
  processing in its own service and database.

### Password Manager

- The embedded CT-Ops vault direction was superseded before customer release.
- Password Manager is now planned as a standalone service/API. Any future
  broker relationship should be designed against that service boundary, not the
  removed embedded CT-Ops implementation.

## Failure Handling

- An unpaired or revoked plugin instance returns an operational error page
  rather than attempting a partial launch.
- Verification failures must return generic access-denied errors without
  leaking trust material or key fingerprints.
- Plugins should redirect users back to the CT Ops launch route when a local
  session expires, the CT Ops session-status check fails, or the launch
  assertion has become stale.

## Follow-On Work

This document completes the shared identity-broker design phase only.

Next phases remain separate:

- Plugin entitlement storage and CT Portal contract.
- CT-CVE integration with real CT Ops launch/session status.
- Future plugin-specific launch/session constraints beyond CT-CVE.
