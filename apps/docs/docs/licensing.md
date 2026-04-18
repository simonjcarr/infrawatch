# Licensing & Tiers

Infrawatch is available in three tiers:

- **Community** — free, open source (Apache 2.0). Everything an engineer or small team needs day-to-day.
- **Pro** — the bulk of paid value: expiry tracking, reports, governance basics, and common corporate IdP integration.
- **Enterprise** — a small set of enterprise-scale capabilities: SAML, advanced RBAC, compliance packs, white labelling, and the operations bundlers.

LDAP / AD login is included in **Community** — it is expected in any serious open-source platform used by corporate engineering teams.

## Tier contents

### Community (free)

- Email / password auth + TOTP MFA
- LDAP / AD login (live bind authentication)
- LDAP Directory User Lookup tool
- Organisations, teams, user management, 4 built-in roles
- Agent registration, approval, heartbeat, self-update, install bundles
- Host inventory, host deduplication, networks with topology graphs
- Check definitions (port, process, HTTP)
- Alerts, acknowledge / silence
- Notification channels: in-app, webhook, SMTP, Slack, Telegram
- Interactive terminal (multi-tab, split-pane)
- Custom script runner, service management
- SSL Certificate Checker tool (one-off URL lookup)
- Metric graphs + retention up to **180 days**
- Air-gap deployment

### Pro (Tier 1)

Everything in Community, plus:

- **Certificate expiry tracker** — dashboards, scheduled expiry notifications, bulk export
- **Service account tracker** — password / token expiry warnings
- CSR generation, approval workflow, internal CA
- SSH key inventory and rotation tracking
- **Reports** — scheduled delivery and CSV / PDF export
- **Extended metric retention** (up to 365 days) and metric export API
- **OIDC single sign-on** (Google, Entra, Okta, Keycloak)
- **Audit log** (user + admin actions, export, retention)
- Scheduled task runner
- Alert routing policies (on-call rotations, escalation)
- Advanced notification templating
- Business-hours email support

### Enterprise (Tier 2)

Everything in Pro, plus:

- **SAML 2.0** single sign-on
- **Advanced RBAC** — tag-based resource scoping, custom role definitions
- **Compliance packs** (SOC 2, ISO 27001, HIPAA-style evidence templates)
- **White labelling** — custom logo, theme, login page, email sender
- Air-gap bundlers for Jenkins, Docker, Ansible, Terraform
- HA deployment profile and migration tooling
- 24 / 7 support with incident SLA and a dedicated CSM

## How licensing works

Infrawatch uses an **offline-capable** licence model. There is no phone-home, no activation server, and no network dependency for validation. This is essential for air-gapped deployments.

### Key format

A licence key is a signed JSON Web Token (JWT, RS256). The public key is bundled into every Infrawatch build. The private signing key is held only by the licence issuance service.

Every key encodes:

- **Organisation** (`sub`) — the customer organisation the key was issued to
- **Tier** — `pro` or `enterprise`
- **Feature list** — the explicit features unlocked by this key (allows custom bundles and à-la-carte add-ons)
- **Expiry** (`exp`) — licence term end date
- **Licence ID** (`jti`) — unique identifier, used for revocation
- **Customer details** — name and email, shown in Settings
- **Seat cap** (`maxHosts`, optional) — maximum number of approved hosts

### Activation

1. Purchase or renew a licence.
2. The issuance service emails the signed licence key to the customer.
3. Paste the key into **Settings → Licence → Licence key**.
4. The server validates the signature, issuer, audience, and expiry locally. No outbound request is made.

For air-gapped installs: download the key on a connected machine, transfer to the target network, and paste into the Infrawatch UI.

### Renewal & expiry

Licences are time-limited via the `exp` claim. When a licence expires, Infrawatch silently falls back to the **Community** tier — no hard shutdown. Paid features become unavailable until a new key is pasted in. Renew at least a few days before expiry to avoid interruption.

### Revocation

Connected installs may opportunistically check a signed revocation list published by the issuance service. Air-gapped installs rely exclusively on the `exp` claim — licence terms are therefore sized short enough (typically one year) for revocation-by-expiry to be acceptable.

### Seat limits

If a licence includes a `maxHosts` cap, agent approval is blocked once that count is reached. Remove or archive decommissioned hosts to free up seats.

## Enforcement

The authoritative licence check happens server-side on every gated action. UI controls for paid features are disabled on Community and hidden or badged appropriately, but the server never trusts the client — attempting to invoke a gated action without a valid licence returns an error.

Currently enforced on Community tier:

- Certificate tracker (`/certificates`) — requires `certExpiryTracker`
- Service account tracker (`/service-accounts`) — requires `serviceAccountTracker`
- Reports (`/reports/*`) — requires `reportsExport`; scheduled software scans require `reportsScheduled`

Community installs see a **"Pro"** badge on each locked entry in the sidebar and an "Upgrade required" screen when the page is visited.

## Circumvention and support

Infrawatch is source-available. A determined engineer with build access can, technically, patch out licence checks. We rely on:

- **Legal** — the commercial licence agreement forbids removal or modification of licence checks.
- **Detection** — tampered builds log telltale signals that are visible to our support team.
- **Support gating** — we do not provide support for builds that do not validate against an issued licence.

If you believe a feature you paid for is not unlocking, contact support before modifying source — it is almost always an issue we can resolve with a new key.
