# Licensing

CT-Ops core is free to use with the Community tier. Community includes the core
operations feature set and 3 included active-user seats. Extra CT-Ops seats are
sold separately, and Enterprise is an add-on entitlement for Enterprise-only
capabilities.

## Tiers And Entitlements

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

Community includes 3 active-user seats for the CT-Ops installation.

### Extra Seats

Extra CT-Ops seats increase the active-user allowance beyond the 3 included
Community seats. For example, a licence with 10 extra seats gives the install a
`maxUsers` allowance of 13.

Extra seats do not change the CT-Ops tier and do not unlock Enterprise-only
capabilities.

### Enterprise

Enterprise is a separate add-on entitlement. It keeps the same seat allowance
from Community plus any purchased extra seats and unlocks Enterprise-only
capabilities such as:

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

The effective `maxUsers` allowance is:

- 3 when no valid CT-Ops seat licence is present.
- 3 plus the active paid extra-seat quantity when a valid seat licence is
  present.

Seats are consumed by:

- Active, non-deleted users
- Pending, unexpired invitations

Seats are not consumed by:

- Deactivated users
- Deleted or removed users
- Expired or accepted invitations

CT-Ops enforces seats on trusted backend flows including invitation creation,
invite acceptance, user restoration, user reactivation, LDAP auto-provisioning,
and session admission.

## Included Seat Pinning

Admins can pin up to 3 active users as the included Community-seat users. These
users keep access if paid seats expire and the installation falls back to the 3
included seats.

If fewer than 3 users are pinned, CT-Ops fills the remaining included seats
deterministically. The fallback preserves at least one active super admin when
one exists, then other pinned/admin users, then the oldest active users.

When an installation has more active users than its current allowance, users
outside the admitted seats are not deleted or deactivated. Their login and
authenticated requests are blocked until seats are renewed, active users are
reduced, or an admin changes the pinned included-seat assignments.

## Licence Keys

CT-Ops uses an offline-capable licence model. A licence key is a signed JSON Web
Token verified locally against the public key bundled with the CT-Ops web
application. Validation does not require an outbound network connection.

Every CT-Ops key can encode:

- Installation identifier (`sub`)
- Tier (`community` or `enterprise`)
- User-seat limit (`maxUsers`)
- Expiry (`exp`)
- Licence ID (`jti`)
- Optional Enterprise feature claims
- Customer details for display and support

The legacy `maxHosts` claim may still appear in older keys for compatibility,
but CT-Ops commercial licensing uses user-seat capacity.

## Activation

1. Open **Settings -> Licence**.
2. Generate an activation token.
3. Paste the activation token into the licence checkout flow.
4. Complete purchase or renewal.
5. Paste the returned licence key into **Settings -> Licence**.

The activation token binds the issued licence to the specific CT-Ops install.
The server validates the licence signature, issuer, audience, expiry, and
installation binding locally before saving the key.

For air-gapped installs, generate the activation token inside the air-gapped
network, transfer it out to complete checkout, then transfer the returned
licence key back in.

## Expiry And Degraded State

When a paid seat licence expires or becomes invalid, CT-Ops degrades to
Community with `maxUsers=3`. Core CT-Ops functionality remains available.
Enterprise-only capabilities are disabled unless a valid Enterprise entitlement
is present.

For example, if an install has 13 active users and 10 paid extra seats, all 13
users can log in while the paid seats are active. After the paid seats expire,
only the 3 pinned or deterministically selected included-seat users can continue
logging in. The other 10 users remain intact but are blocked from new sessions
and authenticated requests.

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
- Included-seat user pinning

If the saved tier in the database disagrees with the validated key, CT-Ops uses
the validated effective licence for enforcement and display.
