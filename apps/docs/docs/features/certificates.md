---
sidebar_position: 4
---

# Certificate Management

Infrawatch discovers TLS certificates on your hosts automatically and tracks their expiry dates — so you know about certificate expirations before they cause outages.

---

## Discovery

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
