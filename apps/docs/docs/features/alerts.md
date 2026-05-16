# Alerts

Alert rules define the conditions under which CT-Ops generates a notification. Rules are evaluated by the alerts consumer as metrics and check results arrive from the queue.

---

## Alert Rule Concepts

### Rule
A condition evaluated against metrics or check results. Examples:
- CPU > 90% sustained for 5 minutes
- `nginx` process not running
- Port 443 unreachable
- Certificate expiry < 14 days

### Alert instance
When a rule fires, an **alert instance** is created. The instance tracks the current state of that specific rule/host combination:
- `firing` — condition is active
- `resolved` — condition is no longer active

Alert instances are never overwritten — each transition (firing → resolved → firing) creates a new record.

### Notification
When an alert instance is created or transitions state, a **notification** is generated and routed to the configured notification channels.

---

## Creating Alert Rules

1. Open a host and select **Monitoring → Alerts**
2. Click **Add Rule**
3. Configure:

| Field | Description |
|---|---|
| **Name** | Human-readable name for the rule |
| **Condition** | Metric or check to evaluate (`cpu_percent`, `memory_percent`, `disk_percent`, check result) |
| **Operator** | `>`, `<`, `>=`, `<=`, `==`, `!=` |
| **Threshold** | Value to compare against |
| **Duration** | How long the condition must be true before firing (e.g. 5 minutes) |
| **Severity** | `info`, `warning`, `critical` |
| **Scope** | All hosts, a specific host, or a host group |
| **Channels** | Which notification channels to route to |

4. Click **Save**

## Global Metric Defaults

Global alert defaults are metric threshold templates. They are not evaluated for
any host until an administrator applies them to that host.

Administrators can apply those defaults when needed:
- On a host's **Alerts** tab, **Use Metric Defaults** replaces that host's
  host-level metric threshold rules with the current global defaults.
- On **Administration → Monitoring**, **Apply to Hosts** replaces host-level
  metric threshold rules across all hosts with the current global defaults.

These actions only replace metric threshold rules. Check, certificate, Docker,
silence, and notification settings are left unchanged.

---

## Silencing

Alert rules can be **silenced** for a specified period. Silencing suppresses notifications without deleting the rule. Useful for planned maintenance windows.

1. Open the rule detail page
2. Click **Silence**
3. Set the duration
4. Click **Confirm**

Silences expire automatically. Active silences are shown on the rule detail page with a countdown.

---

## Alert History

The **Alerts** page shows:
- All currently firing alerts (top panel)
- Alert history — all past instances with timestamps, severity, and resolution status

Each alert instance links to the affected host and the rule that triggered it.

---

## Notification Routing

When an alert fires, notifications are routed to the channels configured on the rule. See [Notifications](./notifications) for the available channel types and how to configure them.
