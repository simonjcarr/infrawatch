---
sidebar_position: 9
---

# Service Accounts & Identity

Infrawatch tracks the users and service accounts present on your hosts — including domain accounts synced from LDAP/Active Directory. This gives you a fleet-wide view of who has access to what.

---

## LDAP / Active Directory Integration

Infrawatch can sync domain accounts from your LDAP directory or Active Directory. This enriches host user inventory with domain context — showing you which AD accounts are present on which hosts.

### Setup

1. Navigate to **Settings → LDAP**
2. Fill in your LDAP server details:

| Field | Description |
|---|---|
| **Server URL** | e.g. `ldap://ad.corp.example.com:389` or `ldaps://...` |
| **Bind DN** | Service account DN used to query the directory |
| **Bind Password** | Password for the bind account |
| **Base DN** | Root DN for user searches (e.g. `dc=corp,dc=example,dc=com`) |
| **User filter** | LDAP filter for user objects (e.g. `(objectClass=user)`) |
| **Username attribute** | Attribute to use as the username (e.g. `sAMAccountName`) |

3. Click **Test Connection** to verify connectivity
4. Click **Save** to enable the integration

### Sync

Infrawatch syncs domain accounts on a configurable schedule (default: every 15 minutes). You can trigger a manual sync from the LDAP settings page by clicking **Sync Now**.

---

## Per-Host User Inventory

The **Users** tab on each host detail page shows:
- Local system accounts
- Domain accounts present on this host (from LDAP sync cross-referenced with agent-collected user data)
- Last login timestamp (where available)
- Account type (local / domain)

Navigate to **Service Accounts** for the fleet-wide view showing which accounts are present across all hosts.

---

## Account Detail

Clicking a user account opens the detail view:

- Account metadata (DN, username, email, department from LDAP)
- **Hosts** — all hosts where this account is present
- **Groups** — AD group memberships
- Event history for this account

---

## SSH Keys

The agent collects SSH authorised keys from `~/.ssh/authorized_keys` on each host. These are displayed in the **Users** tab alongside the account information.

A fleet-wide SSH key inventory is available from the **Service Accounts** page — useful for identifying stale or unexpected authorised keys.

---

## Planned Features

- CSR workflows for certificate requests tied to service accounts
- SSH key rotation reminders
- Automated detection of accounts not in Active Directory (local orphan accounts)
