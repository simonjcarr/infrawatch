---
sidebar_position: 10
---

# Tasks & Runbooks

The Tasks feature lets you run scripts on hosts directly from the Infrawatch UI, and Runbooks provide a way to define reusable, multi-step operational procedures.

---

## Custom Scripts

Custom scripts are shell commands or script files that run on a target host via the agent.

### Creating a script

1. Navigate to **Tasks → Scripts**
2. Click **New Script**
3. Enter a name, description, and the script content
4. Select the target language / interpreter (`bash`, `sh`, `python3`, etc.)
5. Click **Save**

### Running a script

1. From the Scripts list, click **Run** on any script
2. Select the target host (or host group)
3. Click **Execute**

The script runs on the target host(s) via the agent's `shell` check type. Output (stdout, stderr, exit code) streams back to the UI in real time.

---

## Task Runs

Each script execution creates a **task run** record. The task runs page shows:
- Script name
- Target host
- Started at / completed at
- Exit code
- Truncated output preview

Click a task run to see the full stdout/stderr output.

---

## Runbooks

Runbooks are a sequence of steps that can include:
- Script execution
- Manual confirmation prompts
- Condition checks

Runbooks are useful for standardising operational procedures — patch application, service restarts, environment health checks.

### Creating a runbook

1. Navigate to **Tasks → Runbooks**
2. Click **New Runbook**
3. Add steps in order:
   - **Script step** — runs a script on one or more hosts
   - **Approval step** — pauses execution and waits for a human to confirm before continuing
4. Click **Save**

### Running a runbook

1. Click **Run** on any runbook
2. Select the target hosts or host group
3. Click **Start**

Runbook progress is tracked step by step. If an approval step is reached, an in-app notification is sent to the configured approvers.

---

## Patch Management

The task runner integrates with the host's package manager. From the **Tasks** tab on a host detail page you can:
- List available package updates
- Apply selected updates
- View update history

This is equivalent to running `apt upgrade` or `yum update` but tracked and audited through Infrawatch.
