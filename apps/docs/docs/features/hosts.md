# Hosts & Inventory

The Hosts page is the primary inventory view in CT-Ops. It shows every server that has registered an agent, along with real-time status, recent vitals, and quick access to all host-level tooling.

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

## Fleet Overview

At the top of the Hosts page you will see a set of summary cards that give a quick read of the state of the fleet before you dig into the table:

- **Total hosts** registered
- **Online** and **Offline** counts (with the online card showing the percentage of the fleet)
- **Firing alerts** — the number of distinct hosts with at least one alert currently firing
- **Stale** — hosts that have not reported a heartbeat in the last 15 minutes (any online heartbeat should arrive well inside that window, so any count here usually means something is wrong)
- **Pending approval** — agents waiting for an admin to approve them

Below the summary are two further panels:

- **Resource hotspots** — a count of hosts currently at or above **80%** CPU, memory, or disk utilisation. Useful for catching capacity pressure on a busy day before alerts fire.
- **Operating systems** — a breakdown of the fleet by OS, with a bar showing each OS's share. Clicking an OS name filters the host list to that OS.

All of the summary numbers are computed server-side and refresh every 30 seconds, so they stay current without needing a page reload.

---

## Host List

The hosts table shows:
- Hostname
- OS / platform
- IP addresses
- Current CPU / memory / disk percentages (values at or above 80% are highlighted in red)
- Last seen timestamp
- Count of active alerts for the host
- Status badge

Clicking a hostname opens the host detail page.

### Paging, search, sort and filter

The host list is **paged on the server** so that very large fleets load quickly. A fleet of several thousand hosts only ships the current page to the browser, not the whole inventory.

- **Page size** — choose 25, 50 (default), 100 or 200 hosts per page.
- **Search** — free-text search over hostname, display name, and IP addresses. The input is debounced, so the query only fires when you stop typing.
- **Status filter** — restrict to Online, Offline, or Unknown.
- **OS filter** — restrict to any operating system currently present in the inventory. Also wired up to the OS bars in the fleet overview — click a bar to apply the filter.
- **Sorting** — click any sortable column header (hostname, OS, CPU, memory, disk, last seen, status) to sort ascending; click again to flip to descending. Only one column is sorted at a time. `NULL` values are always pushed to the end so that empty metrics never hide real data.

Page, sort, and filter state all reset sensibly as you adjust them — changing a filter always returns you to the first page of results, and there is a **Clear filters** button to reset everything to the default view.

---

## Pending Approval

If an enrolment token does **not** have auto-approve enabled, newly registered agents appear in the **Pending Approval** panel at the top of the Hosts page. Click **Approve** to activate the agent — it will receive a JWT within 30 seconds and begin heartbeating.

To reject a pending agent, click **Revoke**.

---

## Duplicate-Host Protection

Two live hosts in the same organisation cannot share a hostname or IP address — on a real network that would be a configuration error. CT-Ops enforces this at two points:

- **At registration time** — when an agent calls `Register`, the ingest service checks for an existing non-deleted host in the same organisation whose hostname matches or whose reported IP addresses overlap any of the new agent's IPs.
- **At approval time** — the same check runs when an admin approves a pending agent, in case a collision emerged while the agent was queued.

What happens on a match depends on the state of the existing host:

| Existing host state | Result |
|---|---|
| **Online** (heartbeating) or agent **revoked** | Registration is rejected with `ALREADY_EXISTS` — delete the existing host record first |
| **Offline** or **unknown** | The existing row is **adopted**: the new public key is rotated onto the existing `agents` row, the host record is kept, and approval state is preserved |

Adoption covers the common re-registration path: an agent is reinstalled on the same physical machine with its data directory wiped, so it generates a fresh keypair. Without adoption this would leave a stale "Offline" duplicate that the admin has to clean up manually; with adoption the host silently resumes using its existing record.

The key rotation is recorded in the agent's status history (`reason: "adopted re-registration (keypair rotated; matched by hostname or IP)"`) so the event is auditable.

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

### Inventory tab
- All software packages installed on this host, collected by the agent
- Last scan timestamp and a **Rescan** button to trigger an immediate inventory collection
- Stale-scan warning if the last scan is older than the configured interval
- **Show removed** toggle to include packages no longer present on the host
- Client-side search to filter the package list
- **CSV export** of the current host's package list
- **Compare** button to open a side-by-side diff against another host

### Terminal tab
- Live WebSocket PTY terminal session directly to the host via the agent

### Services tab
- Systemd services on this host
- Start / stop / restart controls via the agent

---

## Host Groups

Hosts can be organised into **Host Groups** for bulk operations, scoped alert rules, and RBAC resource scoping. See [Host Groups](./host-groups) for details.

---

## Deleting a Host

Hosts are soft-deleted — the record is retained for audit purposes but the host is hidden from the inventory. To permanently remove a host, revoke its agent and delete the host record from the detail page.

If the agent is currently **online**, the delete dialog offers an **"Also uninstall agent from the remote host"** checkbox. When checked, CT-Ops dispatches an `agent_uninstall` task before removing the host record. The agent runs the uninstaller as a detached child process so it can complete even after the service manager terminates the agent process:

- **Linux (systemd)**: uninstaller runs in a transient systemd unit (`systemd-run --no-block`) so it is not killed when the agent's cgroup is torn down
- **Linux (non-systemd)**: falls back to a new session (`setsid`)
- **macOS**: uses `setsid`-style detach
- **Windows**: uses `CREATE_NEW_PROCESS_GROUP`

If the agent is offline at deletion time, leave the checkbox unchecked and uninstall the agent binary manually.
