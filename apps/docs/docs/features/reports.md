---
sidebar_position: 7
---

# Reports

The Reports section provides fleet-wide views that aggregate data across all hosts. Currently the primary report is the **Software Inventory** report.

---

## Software Inventory

Navigate to **Reports → Software** to see all software packages installed across your fleet.

### What's included

The software inventory aggregates installed packages from every online host:

- Package name
- Version(s) installed
- Number of hosts it's installed on
- First seen timestamp
- Operating system / distribution breakdown

### Searching and filtering

The table supports:
- **Free-text search** — matches on package name
- **OS filter** — filter to a specific platform or distribution
- **Version filter** — find all hosts running a specific version of a package
- **Sortable columns** — sort by name, version, host count, or first seen

Results from multiple hosts running the same package+version are unified into a single row with a host count.

### Identifying outdated software

The version column shows all distinct versions of a package across your fleet. If you see multiple versions of the same package, you can drill down to see which hosts are running each version — useful for identifying hosts that missed a patch cycle.

---

## Exporting Reports

### CSV Export

Click **Export CSV** to download the current filtered view as a comma-separated values file. The export respects active filters and search terms.

### PDF Export

Click **Export PDF** to generate a formatted PDF of the current view. The PDF includes:
- Report title and generation timestamp
- Applied filters
- Full table data

### Rate limiting

Exports are rate-limited to prevent overloading the server on large fleets. You can export once every 10 seconds. If you click Export before the cooldown has elapsed, a countdown timer shows when the next export is available.

---

## OS and Version Charts

The software report page includes two summary charts:

- **OS distribution** — pie/bar chart showing the proportion of hosts by operating system
- **Version breakdown** — for the selected package, shows the distribution of installed versions across the fleet

These charts help you quickly assess the homogeneity of your fleet and identify stragglers that haven't been updated.

---

## Upcoming Reports

Additional reports are planned for future releases:

- **Certificate expiry timeline** — all certificates across the fleet sorted by expiry date
- **Service account inventory** — all domain accounts and SSH keys across the fleet
- **Alert frequency** — most frequently firing alert rules over a time period
- **Agent version compliance** — hosts running agent versions below the current minimum
