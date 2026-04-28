# Reports

The Reports section provides fleet-wide views that aggregate data across all hosts. Currently the primary reports are **Software Inventory**, **Patch Status**, and **Vulnerabilities**.

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

## Vulnerabilities

Navigate to **Reports → Vulnerabilities** to see open Linux OS package CVE findings across the fleet. Findings are created by ingest after it downloads vendor/distro advisory feeds and compares them with agent-reported software inventory.

### Scope

V1 assesses Linux packages collected from `dpkg`, `rpm`, and `apk`. Agents continue to work without the new metadata fields, but older or unsupported inventory is treated as **unassessed** rather than safe. Windows software, macOS apps, Homebrew, Snap, Flatpak, Pacman/Arch, and third-party application registries are not matched in this version.

### Matching model

CT-Ops uses vendor package feeds for affected-package truth and treats NVD/CISA as enrichment. The matcher does not create findings from fuzzy package-name matches or NVD CPE guesses. A host is marked affected only when its package manager, distro/source package, release metadata, and installed version match an advisory range or fixed-version rule.

### Filtering

| Filter | Description |
|---|---|
| **CVE** | Search by CVE identifier |
| **Package** | Search by installed package name |
| **Severity** | Critical / high / medium / low / unknown |
| **Host group** | Limit findings to hosts in a group |
| **Distro** | Ubuntu / Debian / Alpine / RHEL-family feeds |
| **Source** | Installed package source: `dpkg`, `rpm`, or `apk` |
| **Known exploited** | Show only CISA KEV-enriched findings |
| **Fix available** | Show findings that have a fixed package version |

Host detail pages also include an **Inventory → Vulnerabilities** tab for the selected host.

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
