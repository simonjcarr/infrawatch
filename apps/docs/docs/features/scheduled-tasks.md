# Scheduled Tasks

Scheduled Tasks let you run patches, custom scripts, service actions, and software inventory scans on a recurring cadence. A schedule fires on a cron expression and inserts a task run that flows through the same execution path as ad-hoc tasks.

---

## Creating a schedule

1. Navigate to **Scheduled Tasks** in the sidebar
2. Click **New schedule**
3. Fill in the form:
   - **Name** — human-readable label shown in the list
   - **Task type** — `patch`, `custom_script`, `service`, or `software_inventory` (task type is fixed after creation)
   - **Task-specific config** — patch mode, script + interpreter, service name + action, etc.
   - **Target** — a single host or a host group
   - **Max parallel hosts** — only applies to group targets (0 = unlimited)
   - **Cron expression** — 5-field standard cron (`minute hour day-of-month month day-of-week`)
   - **Timezone** — IANA timezone the cron expression is evaluated in (default `UTC`)
   - **Enabled** — disabled schedules never fire
4. The form shows the next 5 scheduled run times so you can verify the cron before saving

---

## Cron syntax

Standard 5-field cron (POSIX-style) is supported. Examples:

| Expression | Meaning |
|---|---|
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour on the hour |
| `0 2 * * *` | Every day at 02:00 |
| `0 6 * * 1` | Every Monday at 06:00 |
| `0 3 1 * *` | On the 1st of every month at 03:00 |

Seconds and non-standard extensions are **not** supported. The lowest granularity is one minute.

---

## Timezone behaviour

The cron expression is evaluated against the schedule's `timezone` field. `0 2 * * *` with `Europe/London` fires at 02:00 local UK time — so it tracks DST transitions automatically.

The sweeper in the ingest service runs every 30 seconds, so a schedule can fire up to 30 seconds late.

---

## Target resolution & skip rules

When a schedule fires:

- **Single host target** — the host must still exist and not be soft-deleted
- **Group target** — all non-deleted member hosts are targeted
- **Patch and service tasks** — non-Linux hosts are filtered out (Linux-only)
- **Custom script and software inventory** — all OSes are eligible

If no eligible hosts remain (target deleted, empty group, all non-Linux for a Linux-only task), the sweeper advances `next_run_at` and logs a warning — no task run is created.

If the cron expression becomes unparseable (manual DB edit), the sweeper disables the schedule to prevent it from spinning.

---

## Running a schedule immediately

From the Scheduled Tasks list, click the **Play** icon next to a schedule to trigger a one-off run without affecting the recurring cadence. This dispatches the same task via the normal trigger helpers and navigates straight to the task run monitor.

---

## Permissions

| Role | Create / Edit / Delete | Toggle enabled | Run now |
|---|---|---|---|
| `super_admin` | ✅ | ✅ | ✅ |
| `org_admin` | ✅ | ✅ | ✅ |
| `engineer` | ✅ | ✅ | ✅ |
| `read_only` | ❌ | ❌ | ❌ |

Schedules are scoped to the creator's CT-Ops instance; read access requires no additional permission beyond a dashboard session.

---

## Viewing runs triggered by a schedule

Open a schedule's detail page to see its 20 most recent runs, each linking through to the full task run monitor. On the Scheduled Tasks list, the **Last run** column also links to the most recent run directly.

---

## Troubleshooting

- **Schedule didn't fire** — verify `Enabled` is on and the next run time is in the past. Check ingest logs for `schedule sweeper:` lines.
- **"no eligible hosts"** — the target host was deleted, the group is empty, or all member hosts are non-Linux for a Linux-only task.
- **Schedule auto-disabled** — the cron expression failed to parse on the server; edit to fix, then re-enable.
