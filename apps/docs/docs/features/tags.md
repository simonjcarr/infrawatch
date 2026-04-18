# Tags

Tags are `key:value` labels applied to hosts (and, in future, other resources).
They drive grouping, filtering, and access scoping. A host has at most one value
per key — assigning a new value to an existing key replaces the old one (AWS /
GCP semantics).

## Where you can set tags

There are four places tags can originate, merged in weakest-to-strongest order:

1. **Organisation defaults** — Settings → Organisation → Default Tags. Applied
   to every newly approved host.
2. **Enrolment token** — chosen when creating an install token. Baked into the
   install bundle so every machine installed with that bundle registers with
   those tags.
3. **Agent CLI** — repeatable `--tag key=value` flag on `ct-ops-agent`.
   Overrides conflicting keys from the bundle config.
4. **Saved tag rules** — dynamic filters that apply tags on host approval and
   on demand. Run last and only fill in keys not already set, so they never
   override explicit operator intent on the same key.

Merge order: `org defaults → token tags → CLI tags → rules` (last-wins).

## Autocomplete and dedupe

All tags live in a normalised catalogue. The TagEditor's two-field key + value
inputs autocomplete from tags already used in the organisation. The unique
index is case-insensitive, so typing `Prod` where `prod` already exists
suggests the canonical spelling instead of creating a near-duplicate.

## Assigning tags

### Per host
Hosts → *hostname* → Settings → Tags. Add, remove, or change tags on the
selected host.

### In bulk
Hosts → Bulk Tag. Build a filter (CIDRs, hostname glob, OS, status, has/lacks
tags), preview the matching hosts, and apply tags in one shot. Optionally save
the filter + tags as a **tag rule**.

### By rule
Settings → Tag Rules. Rules are evaluated on host approval and can be run on
demand from the admin page. Disable a rule to pause it without deleting.

## CLI reference

```
ct-ops-agent --tag env=prod --tag team=platform
```

The flag is repeatable. `key=value` and `key:value` are both accepted. CLI
tags override config-file tags on conflicting keys.

Install-time:

```
ct-ops-agent --install --token <token> --tag datacenter=eu-west-1
```

Tags passed at install time are written into the persisted config so the
service registers with them on every start.

## Host filter DSL

The bulk-tag UI and saved rules share a filter shape:

| Field | Meaning |
| --- | --- |
| `hostnameGlob` | fnmatch-style (supports `*` and `?`) |
| `hostnameContains` | case-insensitive substring |
| `ipCidrs` | any host IP inside any CIDR — uses Postgres `inet <<= cidr` |
| `networkInterfaceName` | case-insensitive match on `metadata.network_interfaces[].name` |
| `os` / `arch` | exact match within list |
| `status` | `online`, `offline`, `unknown` |
| `hasTags` | host must have `(key,value)` — omit value to match any value |
| `lacksTags` | host must not have the entry |

All supplied fields AND together.
