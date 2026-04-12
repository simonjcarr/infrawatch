'use server'

import { db } from '@/lib/db'
import {
  taskRuns,
  taskRunHosts,
  hosts,
  hostGroupMembers,
} from '@/lib/db/schema'
import { eq, and, isNull, desc, inArray, or } from 'drizzle-orm'
import type {
  TaskRun,
  TaskRunHost,
  TaskType,
  TaskConfig,
  PatchTaskConfig,
  CustomScriptTaskConfig,
  ServiceTaskConfig,
  Host,
} from '@/lib/db/schema'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskRunHostWithHost = TaskRunHost & { host: Host }
export type TaskRunWithHosts = TaskRun & { hosts: TaskRunHostWithHost[] }

// ── Generic helpers ───────────────────────────────────────────────────────────

/**
 * Creates a task_run record and task_run_hosts rows for each target host.
 * Hosts that should be skipped (wrong OS etc.) must be passed as skipHosts with
 * a reason; they are inserted immediately in 'skipped' status.
 */
async function createTaskRun(
  orgId: string,
  userId: string,
  targetType: 'host' | 'group',
  targetId: string,
  taskType: TaskType,
  config: TaskConfig,
  maxParallel: number,
  pendingHostIds: string[],
  skipHosts: { hostId: string; reason: string }[],
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(taskRuns)
        .values({
          organisationId: orgId,
          triggeredBy: userId,
          targetType,
          targetId,
          taskType,
          config,
          maxParallel,
        })
        .returning()

      if (!run) return { error: 'Failed to create task run' }

      const hostRows: (typeof taskRunHosts.$inferInsert)[] = [
        ...pendingHostIds.map((hostId) => ({
          organisationId: orgId,
          taskRunId: run.id,
          hostId,
          status: 'pending' as const,
        })),
        ...skipHosts.map(({ hostId, reason }) => ({
          organisationId: orgId,
          taskRunId: run.id,
          hostId,
          status: 'skipped' as const,
          skipReason: reason,
        })),
      ]

      if (hostRows.length > 0) {
        await tx.insert(taskRunHosts).values(hostRows)
      }

      return { success: true, taskRunId: run.id }
    })
  } catch (err) {
    console.error('Failed to create task run:', err)
    return { error: 'Failed to create task run' }
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns the full task run with per-host details and host display info.
 * Used by the monitor page and for status polling.
 */
export async function getTaskRun(
  orgId: string,
  taskRunId: string,
): Promise<TaskRunWithHosts | null> {
  const run = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.id, taskRunId),
      eq(taskRuns.organisationId, orgId),
      isNull(taskRuns.deletedAt),
    ),
  })
  if (!run) return null

  const hostRows = await db.query.taskRunHosts.findMany({
    where: and(
      eq(taskRunHosts.taskRunId, taskRunId),
      eq(taskRunHosts.organisationId, orgId),
      isNull(taskRunHosts.deletedAt),
    ),
  })

  const hostIds = hostRows.map((r) => r.hostId)
  const hostDetails =
    hostIds.length > 0
      ? await db.query.hosts.findMany({
          where: and(
            inArray(hosts.id, hostIds),
            eq(hosts.organisationId, orgId),
          ),
        })
      : []

  const hostMap = new Map(hostDetails.map((h) => [h.id, h]))

  return {
    ...run,
    hosts: hostRows.map((r) => ({
      ...r,
      host: hostMap.get(r.hostId) ?? ({} as Host),
    })),
  }
}

/**
 * Returns the most recent task runs that include a given host (any status).
 * Optionally filtered by task_type.
 */
export async function listTaskRunsForHost(
  orgId: string,
  hostId: string,
  taskType?: string,
): Promise<TaskRunWithHosts[]> {
  // Find task_run_hosts rows for this host
  const hostRunRows = await db.query.taskRunHosts.findMany({
    where: and(
      eq(taskRunHosts.hostId, hostId),
      eq(taskRunHosts.organisationId, orgId),
      isNull(taskRunHosts.deletedAt),
    ),
    columns: { taskRunId: true },
  })

  if (hostRunRows.length === 0) return []

  const runIds = [...new Set(hostRunRows.map((r) => r.taskRunId))]

  const runs = await db.query.taskRuns.findMany({
    where: and(
      inArray(taskRuns.id, runIds),
      eq(taskRuns.organisationId, orgId),
      isNull(taskRuns.deletedAt),
      ...(taskType ? [eq(taskRuns.taskType, taskType as TaskType)] : []),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 50,
  })

  return Promise.all(runs.map((run) => getTaskRun(orgId, run.id).then((r) => r!)))
}

/**
 * Returns the most recent task runs targeting a group.
 * Optionally filtered by task_type.
 */
export async function listTaskRunsForGroup(
  orgId: string,
  groupId: string,
  taskType?: string,
): Promise<TaskRunWithHosts[]> {
  const runs = await db.query.taskRuns.findMany({
    where: and(
      eq(taskRuns.organisationId, orgId),
      eq(taskRuns.targetType, 'group'),
      eq(taskRuns.targetId, groupId),
      isNull(taskRuns.deletedAt),
      ...(taskType ? [eq(taskRuns.taskType, taskType as TaskType)] : []),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 50,
  })

  return Promise.all(runs.map((run) => getTaskRun(orgId, run.id).then((r) => r!)))
}

// ── Cancellation ──────────────────────────────────────────────────────────────

/**
 * Cancels an active task run.
 * - Pending hosts (not yet started) are marked 'cancelled' immediately.
 * - Running hosts are moved to 'cancelling'; the ingest service will signal
 *   the agent to stop the process and the row will transition to 'cancelled'
 *   once the agent acknowledges.
 * - The parent task_run is marked 'cancelling'.
 */
export async function cancelTaskRun(
  orgId: string,
  taskRunId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    return await db.transaction(async (tx) => {
      // Verify ownership and that the run is still active.
      const run = await tx.query.taskRuns.findFirst({
        where: and(
          eq(taskRuns.id, taskRunId),
          eq(taskRuns.organisationId, orgId),
          isNull(taskRuns.deletedAt),
        ),
      })
      if (!run) return { error: 'Task run not found' }
      if (['completed', 'failed', 'cancelled', 'cancelling'].includes(run.status)) {
        return { error: 'Task run is already finished or being cancelled' }
      }

      const now = new Date()

      // Cancel hosts that haven't started yet — no agent signal needed.
      await tx
        .update(taskRunHosts)
        .set({ status: 'cancelled', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(taskRunHosts.taskRunId, taskRunId),
            eq(taskRunHosts.organisationId, orgId),
            eq(taskRunHosts.status, 'pending'),
            isNull(taskRunHosts.deletedAt),
          ),
        )

      // Signal running hosts to stop — the agent will acknowledge on the
      // next heartbeat and the status will transition to 'cancelled'.
      await tx
        .update(taskRunHosts)
        .set({ status: 'cancelling', updatedAt: now })
        .where(
          and(
            eq(taskRunHosts.taskRunId, taskRunId),
            eq(taskRunHosts.organisationId, orgId),
            eq(taskRunHosts.status, 'running'),
            isNull(taskRunHosts.deletedAt),
          ),
        )

      // Move the parent run to 'cancelling' so the UI reflects the intent.
      await tx
        .update(taskRuns)
        .set({ status: 'cancelling', updatedAt: now })
        .where(
          and(
            eq(taskRuns.id, taskRunId),
            isNull(taskRuns.deletedAt),
          ),
        )

      return { success: true }
    })
  } catch (err) {
    console.error('Failed to cancel task run:', err)
    return { error: 'Failed to cancel task run' }
  }
}

// ── Custom script actions ─────────────────────────────────────────────────────

/**
 * Triggers a custom script run against a single host.
 * Works on any OS — the agent will return an error if the interpreter is absent.
 */
export async function triggerCustomScriptRun(
  orgId: string,
  userId: string,
  hostId: string,
  script: string,
  interpreter: 'sh' | 'bash' | 'python3',
  timeoutSeconds?: number,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
  })
  if (!host) return { error: 'Host not found' }

  const config: CustomScriptTaskConfig = { script, interpreter, ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}) }
  return createTaskRun(orgId, userId, 'host', hostId, 'custom_script', config, 1, [hostId], [])
}

/**
 * Triggers a custom script run against all hosts in a group.
 * All hosts are targeted regardless of OS — the agent handles interpreter availability.
 */
export async function triggerGroupCustomScriptRun(
  orgId: string,
  userId: string,
  groupId: string,
  script: string,
  interpreter: 'sh' | 'bash' | 'python3',
  maxParallel: number,
  timeoutSeconds?: number,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.organisationId, orgId),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { hostId: true },
  })
  if (members.length === 0) return { error: 'Group has no members' }

  const hostIds = members.map((m) => m.hostId)
  const config: CustomScriptTaskConfig = { script, interpreter, ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}) }
  return createTaskRun(orgId, userId, 'group', groupId, 'custom_script', config, maxParallel, hostIds, [])
}

// ── Service management actions ────────────────────────────────────────────────

/**
 * Triggers a systemctl service action against a single Linux host.
 * Returns an error for non-Linux hosts.
 */
export async function triggerServiceAction(
  orgId: string,
  userId: string,
  hostId: string,
  serviceName: string,
  action: 'start' | 'stop' | 'restart' | 'status',
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
  })
  if (!host) return { error: 'Host not found' }
  if (host.os?.toLowerCase() !== 'linux') {
    return { error: 'Service management is only supported on Linux hosts' }
  }

  const config: ServiceTaskConfig = { service_name: serviceName, action }
  return createTaskRun(orgId, userId, 'host', hostId, 'service', config, 1, [hostId], [])
}

/**
 * Triggers a systemctl service action against all Linux hosts in a group.
 * Non-Linux hosts are immediately recorded as 'skipped'.
 */
export async function triggerGroupServiceAction(
  orgId: string,
  userId: string,
  groupId: string,
  serviceName: string,
  action: 'start' | 'stop' | 'restart' | 'status',
  maxParallel: number,
): Promise<
  { success: true; taskRunId: string; targetedCount: number; skippedCount: number } | { error: string }
> {
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.organisationId, orgId),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { hostId: true },
  })
  if (members.length === 0) return { error: 'Group has no members' }

  const hostIds = members.map((m) => m.hostId)
  const groupHosts = await db.query.hosts.findMany({
    where: and(
      inArray(hosts.id, hostIds),
      eq(hosts.organisationId, orgId),
      isNull(hosts.deletedAt),
    ),
  })

  const pendingHostIds: string[] = []
  const skipHosts: { hostId: string; reason: string }[] = []

  for (const host of groupHosts) {
    if (host.os?.toLowerCase() === 'linux') {
      pendingHostIds.push(host.id)
    } else {
      skipHosts.push({
        hostId: host.id,
        reason: `non-Linux host (os: ${host.os ?? 'unknown'})`,
      })
    }
  }

  if (pendingHostIds.length === 0 && skipHosts.length === 0) {
    return { error: 'No hosts found in group' }
  }

  const config: ServiceTaskConfig = { service_name: serviceName, action }
  const result = await createTaskRun(
    orgId, userId, 'group', groupId, 'service', config, maxParallel, pendingHostIds, skipHosts,
  )

  if ('error' in result) return result

  return {
    success: true,
    taskRunId: result.taskRunId,
    targetedCount: pendingHostIds.length,
    skippedCount: skipHosts.length,
  }
}

// ── Deletion ──────────────────────────────────────────────────────────────────

/**
 * Soft-deletes one or more task runs (and their host rows).
 * Both tables filter by isNull(deletedAt) in all queries, so the rows
 * disappear automatically after this call.
 */
export async function deleteTaskRuns(
  orgId: string,
  taskRunIds: string[],
): Promise<{ success: true } | { error: string }> {
  if (taskRunIds.length === 0) return { success: true }
  try {
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(taskRunHosts)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(taskRunHosts.taskRunId, taskRunIds),
            eq(taskRunHosts.organisationId, orgId),
            isNull(taskRunHosts.deletedAt),
          ),
        )
      await tx
        .update(taskRuns)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(taskRuns.id, taskRunIds),
            eq(taskRuns.organisationId, orgId),
            isNull(taskRuns.deletedAt),
          ),
        )
    })
    return { success: true }
  } catch (err) {
    console.error('Failed to delete task runs:', err)
    return { error: 'Failed to delete task runs' }
  }
}

// ── Patch-specific actions ────────────────────────────────────────────────────

/**
 * Triggers a patch run against a single host.
 * The host must be Linux — returns an error for non-Linux hosts.
 */
export async function triggerPatchRun(
  orgId: string,
  userId: string,
  hostId: string,
  mode: 'security' | 'all',
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const host = await db.query.hosts.findFirst({
    where: and(
      eq(hosts.id, hostId),
      eq(hosts.organisationId, orgId),
      isNull(hosts.deletedAt),
    ),
  })
  if (!host) return { error: 'Host not found' }
  if (host.os?.toLowerCase() !== 'linux') {
    return { error: 'Patch runs are only supported on Linux hosts' }
  }

  const config: PatchTaskConfig = { mode }
  return createTaskRun(orgId, userId, 'host', hostId, 'patch', config, 1, [hostId], [])
}

/**
 * Triggers a patch run against all Linux hosts in a group.
 * Non-Linux hosts are immediately recorded as 'skipped' with a reason.
 * Returns the number of hosts targeted and skipped.
 */
export async function triggerGroupPatchRun(
  orgId: string,
  userId: string,
  groupId: string,
  mode: 'security' | 'all',
  maxParallel: number,
): Promise<
  { success: true; taskRunId: string; targetedCount: number; skippedCount: number } | { error: string }
> {
  // Fetch all members of the group
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.organisationId, orgId),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { hostId: true },
  })

  if (members.length === 0) {
    return { error: 'Group has no members' }
  }

  const hostIds = members.map((m) => m.hostId)
  const groupHosts = await db.query.hosts.findMany({
    where: and(
      inArray(hosts.id, hostIds),
      eq(hosts.organisationId, orgId),
      isNull(hosts.deletedAt),
    ),
  })

  const pendingHostIds: string[] = []
  const skipHosts: { hostId: string; reason: string }[] = []

  for (const host of groupHosts) {
    if (host.os?.toLowerCase() === 'linux') {
      pendingHostIds.push(host.id)
    } else {
      skipHosts.push({
        hostId: host.id,
        reason: `non-Linux host (os: ${host.os ?? 'unknown'})`,
      })
    }
  }

  if (pendingHostIds.length === 0 && skipHosts.length === 0) {
    return { error: 'No hosts found in group' }
  }

  const config: PatchTaskConfig = { mode }
  const result = await createTaskRun(
    orgId,
    userId,
    'group',
    groupId,
    'patch',
    config,
    maxParallel,
    pendingHostIds,
    skipHosts,
  )

  if ('error' in result) return result

  return {
    success: true,
    taskRunId: result.taskRunId,
    targetedCount: pendingHostIds.length,
    skippedCount: skipHosts.length,
  }
}
