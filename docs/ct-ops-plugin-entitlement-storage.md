# CT Ops Plugin Entitlement Storage Design

Status: Accepted

Date: 2026-05-04

Related:

- `docs/ct-ops-licensing-and-ct-cve-product-decision.md`
- `docs/ct-ops-plugin-identity-broker.md`
- `docs/ct-ops-ct-cve-api-contract.md`

## Context

CT Ops already has the product-level decision to act as the licensing anchor for
first-party plugins and now has a shared plugin identity broker for pairing and
user launch assertions. The remaining gap is entitlement storage and validation:
CT Ops needs one trusted way to bind a CT Portal-issued plugin licence to a
paired plugin instance, expose derived entitlement status to the plugin, and
gate CT Ops-owned launch surfaces.

This phase is especially important because some external plugin products may
need to stay invisible in CT Ops unless the organization has a valid
entitlement. No plugin nav item, settings card, search result, route teaser, or
launch action should appear based only on frontend state or a
customer-managed flag when the product policy requires backend-hidden
visibility.

## Goals

- Keep plugin entitlements bound to the paired CT Ops installation, organization,
  product, and plugin instance.
- Reuse one entitlement model for CT-CVE and future first-party plugins.
- Ensure CT Ops-owned launch and visibility checks are enforceable server-side.
- Let plugins fetch derived subscription status without learning licence secrets.
- Support offline validation and safe degradation in air-gapped installs.
- Preserve an audit trail for licence import, replacement, revocation, and
  visibility changes.

## Non-Goals

- Collecting payment inside CT Ops.
- Exposing raw licence keys or private verification material to plugin UIs.
- Replacing product-specific billing semantics inside CT Portal.
- Making a backend-hidden plugin discoverable before a valid entitlement
  exists.

## Core Model

CT Ops should treat plugin licensing as a normalized entitlement record backed by
an imported CT Portal-issued licence artifact.

### Stored Objects

| Object | Owned by | Responsibility |
| --- | --- | --- |
| Plugin request token | CT Ops + plugin | Proves a paired installation is requesting a plugin licence for a specific product, org, and instance. |
| Imported plugin licence artifact | CT Ops | Stores the signed CT Portal response needed for revalidation and audit. |
| Derived entitlement record | CT Ops | Stores normalized product/org/instance binding, current status, and visibility decisions. |
| Entitlement audit events | CT Ops | Records import, replacement, validation failure, revocation, expiry, and visibility transitions. |

### Suggested Entitlement Record Fields

Required normalized fields:

- `pluginEntitlementId`
- `product`, for example `ct-cve`
- `organisationId`
- `ctOpsInstallationId`
- `pluginInstanceId`
- `pluginKeyFingerprint`
- `plan`
- `capacity`, when the product licence carries seat, vault, host, or similar
  limits
- `status`: `active`, `grace`, `expired`, `revoked`, `invalid`, `missing`, or
  `mismatch`
- `visibilityPolicy`
- `issuedAt`
- `notBefore`
- `expiresAt`
- `lastValidatedAt`
- `lastValidationErrorCode`
- `sourceFingerprint`, for example a licence serial or payload digest
- `rawLicenceCiphertext` or equivalent encrypted-at-rest storage for the
  imported licence artifact when revalidation requires the original payload
- `createdByUserId` and `updatedByUserId`

Recommended integrity fields:

- `portalIssuer`
- `portalKid`
- `revokedAt`
- `replacedByPluginEntitlementId`
- `offlineValidationWindowEndsAt`
- `statusReason`

### Visibility Policy

Entitlement storage should drive CT Ops-owned visibility through a product policy
rather than ad hoc UI checks.

Suggested policy values:

- `hidden-unless-licensed`
- `admin-visible-when-paired`
- `always-visible`

Products that need backend-hidden visibility can use
`hidden-unless-licensed`.

Policy effect for a backend-hidden plugin:

- Without an `active` or explicitly allowed `grace` entitlement, CT Ops must
  not render the plugin's nav item, settings entry, dashboard card, search
  result, or launcher.
- Direct launch routes should return the same not-found or unauthorized shape
  used for unavailable products instead of revealing that a hidden plugin
  exists but is unlicensed.
- The frontend may still receive a generic plugin inventory response, but the
  backend must filter hidden-plugin rows before they reach normal
  customer-facing surfaces when entitlement is missing.
- Any pre-entitlement import path must be generic and admin-only, for example a
  generic plugin licence import page or installer workflow that does not name
  the hidden product until a valid licence is present.

## Request Token Contract

CT Ops and the paired plugin need a request token that CT Portal can verify
before issuing a plugin licence.

Required request-token fields:

| Field | Meaning |
| --- | --- |
| `product` | Plugin product identifier. |
| `ctOpsInstallationId` | Stable CT Ops installation identity from the broker. |
| `orgId` | Organization that will own the entitlement. |
| `pluginInstanceId` | Paired plugin instance audience. |
| `pluginKeyFingerprint` | Fingerprint of the paired plugin trust material. |
| `visibilityPolicy` | Product gating policy expected by CT Ops. |
| `requestedPlan` | Optional requested edition or commercial tier. |
| `requestedCapacity` | Optional product-specific capacity metadata. |
| `pairingId` or `pairingFingerprint` | Binds the request to the approved paired relationship. |
| `createdAt` | Creation time. |
| `exp` | Short expiry, for example 15 minutes. |
| `nonce` | Single-use identifier for replay rejection. |

Request-token rules:

- The token must be signed by CT Ops, by the plugin, or by both under the final
  CT Portal contract. Dual signing is preferred when practical because it proves
  both the CT Ops installation and the paired plugin instance agree on the
  request.
- CT Portal must reject tokens whose `product`, `orgId`, `pluginInstanceId`, or
  `pluginKeyFingerprint` do not match the paired installation contract.
- CT Ops must log request-token creation without logging the raw token value.
- Request tokens must be single use within their validity window.

## CT Portal-Issued Licence Contract

CT Portal should issue a signed plugin licence artifact whose claims can be
validated offline by CT Ops.

Required binding claims:

- `product`
- `ctOpsInstallationId`
- `organisationId`
- `pluginInstanceId`
- `pluginKeyFingerprint`
- `plan`
- `capacity`
- `licenceId`
- `issuedAt`
- `notBefore`
- `expiresAt`
- `status`

Validation rules:

- CT Ops must verify the licence signature against a pinned CT Portal verifier
  key set.
- CT Ops must reject a licence whose installation, organization, product,
  instance, or plugin-key fingerprint does not exactly match the paired plugin
  record.
- Replaced or superseded licences must keep audit history but only one
  entitlement record may be authoritative for a given
  `product + organisationId + pluginInstanceId`.
- Import failures must return machine-readable error codes such as
  `invalid_signature`, `wrong_installation`, `wrong_organisation`,
  `wrong_product`, `wrong_plugin_instance`, `wrong_plugin_key`,
  `expired_licence`, or `revoked_licence`.

## Import And Validation Flow

1. An admin uses a generic CT Ops plugin-licence import path or installer
   workflow.
2. CT Ops authenticates the admin, checks organization scope, and requires an
   existing paired plugin instance for the target product.
3. CT Ops validates the CT Portal signature and exact installation/org/product/
   instance binding.
4. CT Ops stores the raw licence artifact encrypted at rest, writes the
   normalized entitlement row, and emits an audit event.
5. CT Ops recalculates visibility for the product and organization.
6. CT Ops exposes only derived status to plugin or UI consumers.

Periodic revalidation:

- Revalidate imported plugin licences on import, on scheduled background checks,
  before plugin launch, and before returning subscription status to a plugin on
  sensitive paths.
- Keep validation deterministic for air-gapped installs by relying on the local
  verifier key set and signed revocation material that can be imported out of
  band.
- Never require live CT Portal reachability for every launch.

## Derived Subscription Status API

Plugins should consume only a derived CT Ops status response, not the raw
licence artifact.

Suggested generic endpoint:

```text
GET /api/plugins/v1/subscription-status?product=<product>&orgId=<orgId>&pluginInstanceId=<instanceId>
```

Required checks:

- Service-to-service authentication using the signed token or mTLS contract
  already required for plugin integrations.
- Organization binding.
- Product binding.
- Plugin-instance binding.
- Per-token rate limits and replay protection.

Suggested response:

```json
{
  "product": "ct-cve",
  "orgId": "org_123",
  "pluginInstanceId": "passwd_inst_123",
  "configured": true,
  "licensed": true,
  "status": "active",
  "plan": "team",
  "capacity": {
    "maxVaults": 25
  },
  "visibilityPolicy": "hidden-unless-licensed",
  "expiresAt": "2027-05-01T00:00:00Z",
  "lastValidatedAt": "2026-05-04T09:30:00Z"
}
```

Response rules:

- Do not return the raw licence key, request token, verifier key details, or
  any secret binding material.
- `licensed` is derived from the status, not customer input.
- Plugins may use this response to gate plugin-owned processing, but CT Ops must
  keep enforcing CT Ops-owned launch and visibility decisions itself.

## Safe Degradation

CT Ops should degrade plugin entitlements predictably:

- `active`: normal launch and plugin processing allowed.
- `grace`: optional short operator grace period when local validation is
  temporarily stale but the last known licence was valid; hidden-plugin
  visibility should stay enabled only if the grace policy is explicit and
  bounded.
- `expired` or `revoked`: hide hidden-plugin surfaces immediately and stop
  issuing launch assertions.
- `invalid` or `mismatch`: treat as unlicensed, keep audit evidence, and avoid
  exposing plugin hints to non-admin users.
- `missing`: plugin remains absent for `hidden-unless-licensed` products.

Safe-degradation rules:

- No status may cause deletion of plugin-owned data.
- Historical CT Ops reporting that depends on prior imported plugin data may
  stay visible when that is a separate product requirement, but new plugin
  launches and plugin-owned paid processing must stop when entitlement is not
  active.
- Validation errors must not leak raw licence content or internal verifier
  details.

## Audit Requirements

Audit events should exist for:

- request token created
- plugin licence imported
- plugin licence replaced
- plugin licence validation failed
- plugin entitlement expired
- plugin entitlement revoked
- plugin visibility enabled
- plugin visibility disabled

Audit rows must include actor, organization, product, plugin instance, status
transition, and normalized error code, but never raw licence values.

## Security Considerations

- Treat all plugin entitlement decisions as backend-enforced controls.
- Encrypt stored licence artifacts at rest and redact them from logs and API
  responses.
- Reject imports without an existing paired plugin instance so a customer cannot
  attach a licence to an arbitrary URL.
- Bind entitlement checks to both `pluginInstanceId` and
  `pluginKeyFingerprint` so copied databases or moved containers do not inherit
  trust silently.
- Rate-limit import, status, and request-token endpoints and keep request-token
  nonces single use.
- Keep backend-hidden plugins hidden when entitlement is absent so the UI does
  not leak the product's existence in unlicensed environments.

## Follow-On Implementation Work

This document defines the CT Ops-owned contract. Remaining implementation work
still includes:

- database schema and encrypted storage for plugin entitlement artifacts
- request-token generation and nonce persistence
- plugin-licence import and validation handlers
- generic subscription-status endpoint implementation
- hidden-plugin licence gate enforcement in CT Ops UI and launch routes where
  the product policy requires it
- CT-CVE and future plugin-side consumption of derived entitlement status
