# Networks

Networks let you define IP subnets (CIDRs) and automatically group hosts by the network they belong to. When an agent sends a heartbeat, its IP addresses are compared against all defined networks — if an IP falls within a network's CIDR, the host is automatically assigned to that network.

---

## Creating a Network

1. Navigate to **Hosts → Networks**
2. Click **New Network**
3. Enter a name (e.g. `Office LAN`) and a CIDR (e.g. `192.168.1.0/24`)
4. Optionally add a description
5. Click **Create**

---

## Auto-Assignment

On every agent heartbeat, Infrawatch compares the host's reported IP addresses against all defined network CIDRs for the organisation. Membership is kept in sync automatically:

- If an IP falls within a network's CIDR, the host is added to that network (marked **Auto**).
- If the host's IPs change so that none match a network's CIDR, the auto-assigned membership is removed.
- Auto-assignment runs on every heartbeat, so IP changes are reflected within one heartbeat interval.

Auto-assigned memberships are displayed with an **Auto** badge in both the network detail page and the host detail Networks tab.

---

## Manual Assignment

Admins and engineers can also manually add or remove hosts from a network regardless of IP matching:

- From the **network detail page** (`/hosts/networks/[id]`) — add/remove hosts in bulk.
- From the **host detail page** — navigate to **Management → Networks** to add/remove the host from individual networks.

Manually assigned memberships are displayed with a **Manual** badge and are never automatically removed by the auto-assignment process.

:::warning
If you manually remove an auto-assigned host from a network, it will be re-added on the next heartbeat if its IP still falls within the network's CIDR.
:::

---

## Network Membership

A host can belong to multiple networks. Membership is managed from:

- **Hosts → Networks → [network name]** — view all hosts in a network, see assignment type, add/remove hosts
- **Hosts → [host name] → Management → Networks** — view all networks the host belongs to, add/remove networks

---

## Graph View

Both the all-networks page (**Hosts → Networks**) and each individual network detail page include a **Table / Graph** toggle in the top-right. Switching to **Graph** renders an interactive topology diagram:

- **All-networks graph** — every network is shown as a node across the top row, with its member hosts as child nodes below. Hosts that belong to more than one network appear only once and are connected to each network they belong to.
- **Network detail graph** — the selected network node sits above a grid of its member hosts.

Each host node shows a coloured status dot (green online, red offline, slate unknown) and each network node shows its CIDR badge. The graph supports pan, zoom, minimap, and controls. All panels (controls, minimap, edges) respect the active light/dark theme.

The graph data is fetched lazily — it is only loaded when you switch to the graph view, so the table view stays fast for large fleets.

### Animated edges

Edges between networks and hosts use a subtle dashed bezier path with a slow flowing animation. The animation is intentionally understated so the graph stays readable when zoomed out across many hosts. Edge colour uses the current theme's muted foreground, so it adapts to both light and dark mode.

### Right-click host actions

Right-clicking a host node in either graph opens a context menu with:

- **Open terminal** — prompts for a username, then launches an in-app terminal session to that host (see the [Terminal feature](./terminal.md)).
- **Open host detail** — navigates to the host's detail page.

The context menu uses React Flow's `onNodeContextMenu` so the browser's native right-click menu is suppressed inside the graph pane.

---

## Required Roles

| Action | Required Role |
|---|---|
| Create / edit / delete a network | `org_admin`, `super_admin` |
| Add / remove a host from a network | `engineer`, `org_admin`, `super_admin` |
| View networks | All authenticated users |
