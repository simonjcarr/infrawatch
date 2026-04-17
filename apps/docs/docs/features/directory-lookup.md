# Directory User Lookup

Live on-demand lookup of users in your LDAP or Active Directory server. Results are queried at the moment you search — nothing is ever synced or stored in Infrawatch.

This tool is intended for environments where syncing thousands of directory users into Infrawatch would be wasteful or unwanted, but engineers still need to quickly check a user's directory details: DN, password expiry, group memberships, and other LDAP attributes.

---

## Prerequisites

You need at least one enabled LDAP or Active Directory configuration at **Settings → LDAP / Directory**. See the settings page for details on bind credentials, TLS/STARTTLS, base DN, and user-search filters.

If you have multiple directory configurations, the lookup page shows a directory selector.

---

## Looking up a user

Navigate to **Tooling → Directory User Lookup**.

1. (If multiple configs are set up) pick the directory server from the dropdown.
2. Start typing a username in the search field. Matches appear in a dropdown after ~300 ms.
3. Click a match to fetch the full record.

The username search uses your configuration's `userSearchFilter` with the typed value substituted for `{{username}}`. The search appends `*` for prefix matching, so typing `jsm` will match `jsmith`, `jsmithers`, etc.

---

## What you see

Once a user is selected, Infrawatch queries the directory for all attributes on that DN (both user and operational attributes) and displays:

- **Summary** — display name, username, status badge (locked/active), email, sAMAccountName, UPN, distinguished name (copyable)
- **Password** — expires, last changed, account locked status
    - Active Directory: parses `msDS-UserPasswordExpiryTimeComputed`, `accountExpires`, `pwdLastSet`, `lockoutTime`, `userAccountControl`
    - OpenLDAP / shadow: parses `shadowLastChange`, `shadowMax`, `pwdChangedTime`, `pwdAccountLockedTime`
- **Groups** — full list of `memberOf` group DNs, with a client-side filter for directories where a single user may belong to hundreds of groups. Each entry shows the group's common name with the full DN beneath, and a copy button.
- **All LDAP Attributes** — a collapsible table showing every attribute returned for the user, with its own search filter so you can quickly find what you need. Binary values render as `[binary NB]`; password-hash attributes are excluded for safety.

---

## No sync, no storage

Directory Lookup never writes results to the Infrawatch database. Every search produces a fresh query against the directory — you always see the current state.

This is intentional for environments where the directory contains tens of thousands of users and groups. If you want to track a handful of directory accounts inside Infrawatch (for status or password-expiry monitoring), add them manually on the **[Service Accounts](./service-accounts.md)** page.

---

## Permissions

Any authenticated user in the organisation can run directory lookups. Managing LDAP configurations (adding, editing, deleting) is restricted to `org_admin` and `super_admin`.
