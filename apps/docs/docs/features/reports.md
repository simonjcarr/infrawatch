# Reports

The Reports section provides fleet-wide views that aggregate data across all hosts. Currently the primary report is the **Software Inventory** report.

---

## Software Inventory

Navigate to **Reports → Software** to see all software packages installed across your fleet.

### Package detail view

The report centres on a **package search combobox** (typeahead). Start typing a package name and select from matching results. Once a package is selected:

- All hosts with that package installed are listed, grouped by version
- Each row shows: hostname (clickable — opens the host detail page), OS version, source (dpkg/rpm/brew/etc.), architecture, and last seen timestamp
- The **first-seen** column shows when the package was first observed anywhere in your fleet

### Filtering

| Filter | Description |
|---|---|
| **Package name** | Typeahead combobox — start typing to search |
| **Version** | Dropdown of versions present in the DB for the selected package; pick one to see only hosts on that version |
| **OS type** | Linux / macOS / Windows (derived from `hosts.os`) |
| **Host group** | Limit results to hosts in a specific host group |

### Saved filters

Click **Save filters** to store the current filter combination under a name. Saved filters appear in a dropdown — select one to restore all filter values instantly. Saved filters are per-user and stored in the database.

### Comparing hosts

Select a package, then click **Compare hosts** to open a side-by-side diff between two hosts showing which packages differ — useful for diagnosing why two nominally identical hosts behave differently.

### Identifying outdated software

With a package selected, the version filter shows every distinct version installed across your fleet. Select a specific version to see exactly which hosts are running it — useful for tracking down hosts that missed a patch cycle.

---

## Exporting Reports

### CSV Export

Click **Export CSV** to download the current filtered view as a comma-separated values file. The export respects the active package, version, OS type, and host group filters.

### PDF Export

Click **Export PDF** to generate a formatted PDF of the current view. The PDF includes:
- Report title and generation timestamp
- Applied filters
- Full table data

### Rate limiting

Exports use a **sliding window** rate limit: up to 3 exports per 10-second window. If the limit is reached, the button shows a countdown and any error is displayed in a modal dialog.

---

## OS and Version Charts

The software report page includes two summary charts for the selected package:

- **OS distribution** — pie/bar chart showing the proportion of hosts by operating system
- **Version breakdown** — distribution of installed versions across the fleet

Chart axis labels are theme-aware and remain visible in both light and dark mode.

These charts help you quickly assess fleet homogeneity and identify hosts that haven't been updated.

---

## Software Inventory Settings

Navigate to **Settings → Software Inventory** to configure fleet-wide collection behaviour:

| Setting | Description |
|---|---|
| **Enable inventory** | Master toggle — disables the sweeper and removes the Inventory tab when off |
| **Scan interval (hours)** | How often the sweeper dispatches a scan task per host |
| **Snap packages** | Include Snap packages on Linux |
| **Flatpak packages** | Include Flatpak packages on Linux |
| **Windows Store apps** | Include Windows Store applications on Windows |

---

## Upcoming Reports

Additional reports are planned for future releases:

- **Certificate expiry timeline** — all certificates across the fleet sorted by expiry date
- **Service account inventory** — all domain accounts and SSH keys across the fleet
- **Alert frequency** — most frequently firing alert rules over a time period
- **Agent version compliance** — hosts running agent versions below the current minimum
