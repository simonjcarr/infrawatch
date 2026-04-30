# Licensing

CT-Ops uses open-source, seat-based licensing. Core CT-Ops functionality is
available in Community installs; paid CT-Ops tiers are based on user seats, and
Enterprise adds Enterprise-only capabilities.

## Tiers

### Community

Community is open source and includes core CT-Ops functionality:

- Agent registration, approval, heartbeat, self-update, and install bundles
- Host inventory, networks, tags, notes, and host groups
- Monitoring checks, metric graphs, alerts, silences, and notifications
- Certificate tracking and service-account tracking
- Software inventory, patch status, and report export
- Interactive terminal, scheduled tasks, service management, and script runs
- LDAP / Active Directory login and directory lookup
- Air-gap deployment support

Community capacity is governed by the included user seats for the install.

### Pro

Pro is the paid CT-Ops tier for teams that need additional user-seat capacity.
It uses the same core CT-Ops feature set as Community, with a signed licence
that can carry a `maxUsers` seat limit and expiry date.

### Enterprise

Enterprise is seat-based and includes Enterprise-only capabilities:

- SAML 2.0 single sign-on
- Advanced RBAC and custom role definitions
- Compliance packs
- White labelling
- Air-gap bundlers for enterprise toolchains
- HA deployment profile and migration tooling
- Enterprise support commitments

Enterprise restrictions are enforced on trusted backend paths. UI indicators are
only a convenience and are not the source of authority.

## Seat Limits

The `maxUsers` licence claim defines the paid user-seat limit.

Seats are consumed by:

- Active, non-deleted users
- Pending, unexpired invitations

Seats are not consumed by:

- Deactivated users
- Deleted or removed users
- Expired or accepted invitations

CT-Ops enforces seats on trusted backend flows including invitation creation,
invite acceptance, user restoration, user reactivation, and LDAP
auto-provisioning.

Licences without a `maxUsers` claim are treated as unlimited for compatibility
with earlier licence payloads.

## Licence Keys

CT-Ops uses an offline-capable licence model. A licence key is a signed JSON Web
Token verified locally against the public key bundled with the CT-Ops web
application. Validation does not require an outbound network connection.

Every paid key can encode:

- Install organisation (`sub`)
- Tier (`pro` or `enterprise`)
- User-seat limit (`maxUsers`)
- Expiry (`exp`)
- Licence ID (`jti`)
- Optional Enterprise feature claims
- Customer details for display and support

The legacy `maxHosts` claim may still appear in older keys for compatibility,
but CT-Ops commercial licensing is moving to user-seat capacity.

## Activation

1. Open **Settings -> Licence**.
2. Generate an activation token.
3. Paste the activation token into the licence checkout flow.
4. Complete purchase or renewal.
5. Paste the returned licence key into **Settings -> Licence**.

The activation token binds the issued licence to the specific CT-Ops install.
The server validates the licence signature, issuer, audience, expiry, and
organisation binding locally before saving the key.

For air-gapped installs, generate the activation token inside the air-gapped
network, transfer it out to complete checkout, then transfer the returned
licence key back in.

## Expiry And Degraded State

When a paid licence expires or becomes invalid, CT-Ops degrades to Community
without shutting down the install. Core CT-Ops functionality remains available.
Enterprise-only capabilities are disabled unless a valid Enterprise entitlement
is present.

Renew before the expiry date shown in **Settings -> Licence** to avoid losing
paid seat capacity or Enterprise capabilities.

## Revocation

Connected installs may check a signed revocation bundle published by the
licence service. Air-gapped installs rely on the JWT expiry date.

When `LICENCE_REVOCATION_URL` is unset, CT-Ops uses the default signed bundle
URL. If the endpoint cannot be reached, CT-Ops reuses the last known valid
bundle; if no bundle has been fetched, validation falls back to the JWT expiry
claim.

## Settings Display

The **Settings -> Licence** page shows:

- Current effective tier
- Active users
- Pending invitations
- Seat limit
- Seats remaining
- Licence expiry
- Enterprise capability status

If the saved tier in the database disagrees with the validated key, CT-Ops uses
the validated effective licence for enforcement and display.
