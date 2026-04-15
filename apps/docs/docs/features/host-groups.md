# Host Groups

Host Groups let you organise hosts into logical collections — by environment (production / staging), team ownership, geography, or any other dimension that makes sense for your organisation.

---

## Creating a Group

1. Navigate to **Hosts → Groups**
2. Click **New Group**
3. Enter a name and optional description
4. Click **Create**

Hosts can be added to a group from either the group detail page or the host detail page.

---

## Using Groups

### Scoped alert rules

Alert rules can be scoped to a specific host group. An alert rule scoped to `production-web` only fires for hosts in that group, reducing noise.

### Bulk operations

Actions like running a custom script or checking service status can target an entire group rather than individual hosts.

### RBAC resource scoping

Users with the `engineer` role can be granted access to specific host groups. Their access is limited to hosts within those groups — they cannot see or interact with hosts outside their assigned groups.

---

## Group Membership

A host can belong to multiple groups. Group membership is managed from:
- The group detail page (`/hosts/groups/[id]`) — add/remove hosts in bulk
- The host detail page — add/remove the host from individual groups

---

## Comparing Hosts

The host comparison view (`/hosts/[id]/compare`) lets you select two or more hosts from the same group and view their metrics side by side. Useful for identifying outliers.
