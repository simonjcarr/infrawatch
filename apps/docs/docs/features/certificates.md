# Certificate Management

Infrawatch discovers TLS certificates on your hosts automatically and tracks their expiry dates — so you know about certificate expirations before they cause outages.

---

## Provenance

Certificates in the tracker come from two sources:

1. **Agent-discovered** — picked up by an agent's filesystem or port scan of a host. These carry a link back to the host they were found on.
2. **Imported** — promoted from the [SSL Certificate Checker](./certificate-checker) via the **Track this certificate** button. Imported certificates are either periodically re-fetched from a URL or tracked as a static expiry reminder (see [Certificate Checker → Promoting a Certificate into the Tracker](./certificate-checker#promoting-a-certificate-into-the-tracker)).

To add a certificate that was not discovered by an agent, open **Certificates** and click **Add tracked certificate**. You will be directed to the Certificate Checker, which is the single entry point for imports.

---

## Discovery (agent-based)

The agent scans the host filesystem for PEM-encoded certificates and reports them back to the ingest service. Common locations scanned include:

- `/etc/ssl/certs/`
- `/etc/pki/`
- Application-specific paths you can configure

Discovered certificates are parsed and stored with:
- Subject / issuer / SANs
- Not-before / not-after dates
- Fingerprint (SHA-256)
- File path on the host

---

## URL Refresh (imported certificates)

Certificates imported from the **Check URL** tab of the Certificate Checker are re-verified by the ingest service on a schedule set when they were added (15m / 1h / 6h / 24h).

- Each tick, the ingest service opens a fresh TLS connection to the stored URL and reads the leaf certificate.
- If the fingerprint is unchanged, status and `last_refreshed_at` are updated in place.
- If the fingerprint has changed, a renewal is recorded: the previous row is kept for history and a new row takes over as the current tracked certificate (same URL, same refresh interval).
- If the fetch fails (DNS, TCP, TLS handshake, or expired cert), the failure is recorded and the last known certificate data is left untouched so expiry reminders continue to work.

Imported upload-only certificates have no URL to re-check — when they are renewed, re-upload the new certificate via the Certificate Checker.

---

## Certificate Inventory

Navigate to **Certificates** to see all discovered certificates across your fleet.

The table shows:
- Common name / subject
- Host(s) where the certificate was found
- Issuer
- Expiry date
- Days remaining (colour-coded: red < 14 days, amber < 30 days, green otherwise)
- Status badge

---

## Certificate Detail

Clicking a certificate opens the detail view:

- Full X.509 details (subject, issuer, SANs, key type, fingerprint)
- All hosts where this certificate is present
- **Event timeline** — historical record of when the certificate was first seen, renewed, or expired

---

## Expiry Alerts

You can configure alert rules that fire when a certificate is approaching expiry. Typical thresholds:

- 30 days before expiry — warning notification to the team
- 7 days before expiry — critical alert, pages on-call

See [Alerts](./alerts) for how to create these rules.

---

## Certificate Events

Every significant change to a certificate (first discovered, expiry date changed, removed from host) is appended to the event spine. This gives you a full audit trail for compliance purposes.
