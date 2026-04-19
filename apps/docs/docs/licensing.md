# Licensing & Tiers

CT-Ops is available in three tiers:

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

CT-Ops uses an **offline-capable** licence model. There is no phone-home, no activation server, and no network dependency for validation. This is essential for air-gapped deployments.

### Key format

A licence key is a signed JSON Web Token (JWT, RS256). The public key is bundled into every CT-Ops build. The private signing key is held only by the licence issuance service.

Every key encodes:

- **Install organisation** (`sub`) — the id of the specific CT-Ops install the key was minted for. Verified on activation; a key issued for one install cannot be activated on a different install.
- **Tier** — `pro` or `enterprise`
- **Feature list** — the explicit features unlocked by this key (allows custom bundles and à-la-carte add-ons)
- **Expiry** (`exp`) — licence term end date
- **Licence ID** (`jti`) — unique identifier, used for revocation
- **Customer details** — name and email, shown in Settings
- **Seat cap** (`maxHosts`, optional) — maximum number of approved hosts

### Activation

Licences are bound to the specific install that purchases them via an **activation token** the customer copies from their install into the purchase flow. This prevents a single licence key being reused across unrelated installs.

1. In your CT-Ops install, go to **Settings → Licence** and click **Generate activation token**. Copy the token (starts with `infw-act_…`).
2. Visit the licence purchase site and paste the activation token into the checkout. The site shows the install name decoded from the token so you can confirm you pasted the right one.
3. Complete payment. The issuance service mints a licence key whose `sub` claim is your install's organisation id, and emails it to your technical contact.
4. Paste the returned key into **Settings → Licence → Licence key**.
5. The server validates the signature, issuer, audience, expiry, and that the `sub` matches this install. All checks are local — no outbound request is made.

For air-gapped installs: generate the activation token inside the air-gapped network, transfer it out, complete purchase on a connected machine, and transfer the returned licence key back in. No network path between the install and the licence service is required.

### Renewal & expiry

Licences are time-limited via the `exp` claim. When a licence expires, CT-Ops silently falls back to the **Community** tier — no hard shutdown. Paid features become unavailable until a new key is pasted in. Renew at least a few days before expiry to avoid interruption.

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

CT-Ops is source-available. A determined engineer with build access can, technically, patch out licence checks. We rely on:

- **Legal** — the commercial licence agreement forbids removal or modification of licence checks.
- **Detection** — tampered builds log telltale signals that are visible to our support team.
- **Support gating** — we do not provide support for builds that do not validate against an issued licence.

If you believe a feature you paid for is not unlocking, contact support before modifying source — it is almost always an issue we can resolve with a new key.
