# Service Accounts & Identity

Infrawatch tracks two distinct but related things:

- **Service Accounts** — a manually-maintained register of service/domain accounts you want to track, with status and password-expiry tracking
- **Host user inventory** — local system accounts and SSH keys discovered by the agent on each host

For live on-demand lookup against your LDAP or Active Directory (no syncing), see **[Directory User Lookup](./directory-lookup.md)**.

---

## Tracked Service Accounts

The **Service Accounts** page holds a manually-curated list of the service or domain accounts your team wants to track — for example, deploy bots, CI tokens, shared mailbox accounts, or domain service accounts tied to specific infrastructure.

### Fields

| Field | Description |
|---|---|
| **Username** | Unique within the organisation |
| **Display Name** | Friendly label |
| **Email** | Optional contact address |
| **Status** | `active`, `disabled`, `locked`, or `expired` |
| **Password Expiry Date** | Optional — used to surface upcoming rotations |

### Adding an account

Click **Add Account** and enter the username (plus any optional details). You can edit or delete accounts later from the detail page.

Accounts are independent of LDAP — even if you have an LDAP configuration set up, Infrawatch does not sync accounts from the directory. Use the **[Directory User Lookup](./directory-lookup.md)** tool when you need live directory information.

---

## Per-Host User Inventory

The **Users** tab on each host detail page shows:
- Local system accounts discovered by the agent
- Account type (human / service / system)
- Login capability, running-process hints, password expiry (where exposed by the OS)
- Authorised SSH keys per account

This is independent of the Service Accounts register above — it's a live picture of what the agent sees on that host.

---

## SSH Keys

The agent collects SSH authorised keys from `~/.ssh/authorized_keys` on each host. These are displayed in the **Users** tab alongside the account information, and surfaced fleet-wide from the host user inventory.

---

## LDAP / Directory Integration

Infrawatch can connect to an LDAP or Active Directory server for two purposes:

1. **[Directory User Lookup](./directory-lookup.md)** — search and inspect users on demand
2. **Domain login** — optionally allow users to sign in to Infrawatch with their directory credentials

Configure connections at **Settings → LDAP / Directory**. Nothing is ever synced from the directory into Infrawatch.

---

## Planned Features

- CSR workflows for certificate requests tied to service accounts
- SSH key rotation reminders
- Automated detection of accounts not in the directory (local orphan accounts)
