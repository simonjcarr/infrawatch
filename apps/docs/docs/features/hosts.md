---
sidebar_position: 1
---

# Hosts & Inventory

The Hosts page is the primary inventory view in Infrawatch. It shows every server that has registered an agent, along with real-time status, recent vitals, and quick access to all host-level tooling.

---

## Host Status

Each host has one of three statuses:

| Status | Meaning |
|---|---|
| **Online** | Agent heartbeating normally |
| **Offline** | Agent stream closed or no heartbeat received within 2× the configured interval |
| **Pending** | Agent registered but not yet approved by an admin |

Status is derived in real time from the ingest heartbeat stream — there is no polling from the web app.

---

## Host List

The hosts table shows:
- Hostname
- IP address
- OS / platform
- Last seen timestamp
- Current CPU / memory / disk percentages
- Status badge

Clicking a hostname opens the host detail page.

---

## Pending Approval

If an enrolment token does **not** have auto-approve enabled, newly registered agents appear in the **Pending Approval** panel at the top of the Hosts page. Click **Approve** to activate the agent — it will receive a JWT within 30 seconds and begin heartbeating.

To reject a pending agent, click **Revoke**.

---

## Host Detail Page

The host detail page (`/hosts/[id]`) provides a full view of a single host:

### Overview tab
- Host metadata (hostname, IP, OS, first seen, last seen)
- Agent identity (agent ID, version, approval status)
- Current vitals (CPU, memory, disk, uptime)

### Metrics tab
- Time-series charts for CPU %, memory %, disk %, and network I/O
- Adjustable time range (1h, 6h, 24h, 7d, 30d)
- Chart zoom with drag-to-select

### Checks tab
- List of configured health checks for this host
- Most recent result for each check (pass/fail, output)

### Certificates tab
- TLS certificates discovered on this host by the agent
- Expiry dates and status

### Users tab
- Local and domain accounts present on this host
- Synced via LDAP/Active Directory integration

### Terminal tab
- Live WebSocket PTY terminal session directly to the host via the agent

### Services tab
- Systemd services on this host
- Start / stop / restart controls via the agent

---

## Filtering and Search

The host list supports filtering by:
- Status (Online / Offline / Pending)
- Host group membership
- OS type
- Free-text search on hostname

---

## Host Groups

Hosts can be organised into **Host Groups** for bulk operations, scoped alert rules, and RBAC resource scoping. See [Host Groups](./host-groups) for details.

---

## Deleting a Host

Hosts are soft-deleted — the record is retained for audit purposes but the host is hidden from the inventory. To permanently remove a host, revoke its agent and delete the host record from the detail page.
