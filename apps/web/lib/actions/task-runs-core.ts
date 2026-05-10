'use server'

import { logError } from '@/lib/logging'
import { requireInstanceAdminAccess, requireInstanceToolingAccess } from '@/lib/actions/action-auth'

import { db } from '@/lib/db'
import {
  taskRuns,
  taskRunHosts,
  hosts,
  hostGroupMembers,
} from '@/lib/db/schema'
import { eq, and, isNull, isNotNull, desc, inArray } from 'drizzle-orm'
import type {
  TaskRun,
  TaskRunHost,
  TaskType,
  TaskConfig,
  PatchTaskConfig,
  CustomScriptTaskConfig,
  ServiceTaskConfig,
  AgentUninstallTaskConfig,
  Host,
} from '@/lib/db/schema'

export type TaskRunHostWithHost = TaskRunHost & { host: Host }
export type TaskRunWithHosts = TaskRun & { hosts: TaskRunHostWithHost[] }

async function createTaskRun(
  currentScope: string,
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
          instanceId: currentScope,
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
          instanceId: currentScope,
          taskRunId: run.id,
          hostId,
          status: 'pending' as const,
        })),
        ...skipHosts.map(({ hostId, reason }) => ({
          instanceId: currentScope,
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
    logError('Failed to create task run:', err)
    return { error: 'Failed to create task run' }
  }
}

export async function getTaskRun(
  currentScope: string,
  taskRunId: string,
): Promise<TaskRunWithHosts | null> {
  await requireInstanceToolingAccess(currentScope)
  const run = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.id, taskRunId),
      eq(taskRuns.instanceId, currentScope),
      isNull(taskRuns.deletedAt),
    ),
  })
  if (!run) return null

  const hostRows = await db.query.taskRunHosts.findMany({
    where: and(
      eq(taskRunHosts.taskRunId, taskRunId),
      eq(taskRunHosts.instanceId, currentScope),
      isNull(taskRunHosts.deletedAt),
    ),
  })

  const hostIds = hostRows.map((r) => r.hostId)
  const hostDetails =
    hostIds.length > 0
      ? await db.query.hosts.findMany({
          where: and(
            inArray(hosts.id, hostIds),
            eq(hosts.instanceId, currentScope),
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

export async function listTaskRunsForHost(
  currentScope: string,
  hostId: string,
  taskType?: string,
): Promise<TaskRunWithHosts[]> {
  await requireInstanceToolingAccess(currentScope)
  const hostRunRows = await db.query.taskRunHosts.findMany({
    where: and(
      eq(taskRunHosts.hostId, hostId),
      eq(taskRunHosts.instanceId, currentScope),
      isNull(taskRunHosts.deletedAt),
    ),
    columns: { taskRunId: true },
  })

  if (hostRunRows.length === 0) return []

  const runIds = [...new Set(hostRunRows.map((r) => r.taskRunId))]

  const runs = await db.query.taskRuns.findMany({
    where: and(
      inArray(taskRuns.id, runIds),
      eq(taskRuns.instanceId, currentScope),
      isNull(taskRuns.deletedAt),
      isNotNull(taskRuns.triggeredBy),
      ...(taskType ? [eq(taskRuns.taskType, taskType as TaskType)] : []),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 50,
  })

  return Promise.all(runs.map((run) => getTaskRun(currentScope, run.id).then((r) => r!)))
}

export async function listAutomatedRunsForHost(
  currentScope: string,
  hostId: string,
  taskType?: string,
): Promise<TaskRunWithHosts[]> {
  await requireInstanceToolingAccess(currentScope)
  const hostRunRows = await db.query.taskRunHosts.findMany({
    where: and(
      eq(taskRunHosts.hostId, hostId),
      eq(taskRunHosts.instanceId, currentScope),
      isNull(taskRunHosts.deletedAt),
    ),
    columns: { taskRunId: true },
  })

  if (hostRunRows.length === 0) return []

  const runIds = [...new Set(hostRunRows.map((r) => r.taskRunId))]

  const runs = await db.query.taskRuns.findMany({
    where: and(
      inArray(taskRuns.id, runIds),
      eq(taskRuns.instanceId, currentScope),
      isNull(taskRuns.deletedAt),
      isNull(taskRuns.triggeredBy),
      ...(taskType ? [eq(taskRuns.taskType, taskType as TaskType)] : []),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 50,
  })

  return Promise.all(runs.map((run) => getTaskRun(currentScope, run.id).then((r) => r!)))
}

export async function listTaskRunsForGroup(
  currentScope: string,
  groupId: string,
  taskType?: string,
): Promise<TaskRunWithHosts[]> {
  await requireInstanceToolingAccess(currentScope)
  const runs = await db.query.taskRuns.findMany({
    where: and(
      eq(taskRuns.instanceId, currentScope),
      eq(taskRuns.targetType, 'group'),
      eq(taskRuns.targetId, groupId),
      isNull(taskRuns.deletedAt),
      ...(taskType ? [eq(taskRuns.taskType, taskType as TaskType)] : []),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 50,
  })

  return Promise.all(runs.map((run) => getTaskRun(currentScope, run.id).then((r) => r!)))
}

export async function cancelTaskRun(
  currentScope: string,
  taskRunId: string,
): Promise<{ success: true } | { error: string }> {
  await requireInstanceToolingAccess(currentScope)
  try {
    return await db.transaction(async (tx) => {
      const run = await tx.query.taskRuns.findFirst({
        where: and(
          eq(taskRuns.id, taskRunId),
          eq(taskRuns.instanceId, currentScope),
          isNull(taskRuns.deletedAt),
        ),
      })
      if (!run) return { error: 'Task run not found' }
      if (['completed', 'failed', 'cancelled', 'cancelling'].includes(run.status)) {
        return { error: 'Task run is already finished or being cancelled' }
      }

      const now = new Date()

      await tx
        .update(taskRunHosts)
        .set({ status: 'cancelled', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(taskRunHosts.taskRunId, taskRunId),
            eq(taskRunHosts.instanceId, currentScope),
            eq(taskRunHosts.status, 'pending'),
            isNull(taskRunHosts.deletedAt),
          ),
        )

      await tx
        .update(taskRunHosts)
        .set({ status: 'cancelling', updatedAt: now })
        .where(
          and(
            eq(taskRunHosts.taskRunId, taskRunId),
            eq(taskRunHosts.instanceId, currentScope),
            eq(taskRunHosts.status, 'running'),
            isNull(taskRunHosts.deletedAt),
          ),
        )

      await tx
        .update(taskRuns)
        .set({ status: 'cancelling', updatedAt: now })
        .where(and(eq(taskRuns.id, taskRunId), isNull(taskRuns.deletedAt)))

      return { success: true }
    })
  } catch (err) {
    logError('Failed to cancel task run:', err)
    return { error: 'Failed to cancel task run' }
  }
}

const MAX_SCRIPT_LENGTH: Record<'sh' | 'bash' | 'python3', number> = {
  sh: 65_536,
  bash: 65_536,
  python3: 65_536,
}

export async function triggerCustomScriptRun(
  currentScope: string,
  hostId: string,
  script: string,
  interpreter: 'sh' | 'bash' | 'python3',
  timeoutSeconds?: number,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await requireInstanceAdminAccess(currentScope)
  if (script.length > MAX_SCRIPT_LENGTH[interpreter]) {
    return { error: `Script exceeds the ${MAX_SCRIPT_LENGTH[interpreter] / 1024} KB size limit for ${interpreter}` }
  }

  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
  })
  if (!host) return { error: 'Host not found' }

  const config: CustomScriptTaskConfig = { script, interpreter, ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}) }
  return createTaskRun(currentScope, session.user.id, 'host', hostId, 'custom_script', config, 1, [hostId], [])
}

export async function triggerGroupCustomScriptRun(
  currentScope: string,
  groupId: string,
  script: string,
  interpreter: 'sh' | 'bash' | 'python3',
  maxParallel: number,
  timeoutSeconds?: number,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await requireInstanceAdminAccess(currentScope)
  if (script.length > MAX_SCRIPT_LENGTH[interpreter]) {
    return { error: `Script exceeds the ${MAX_SCRIPT_LENGTH[interpreter] / 1024} KB size limit for ${interpreter}` }
  }
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.instanceId, currentScope),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { hostId: true },
  })
  if (members.length === 0) return { error: 'Group has no members' }

  const hostIds = members.map((m) => m.hostId)
  const config: CustomScriptTaskConfig = { script, interpreter, ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}) }
  return createTaskRun(currentScope, session.user.id, 'group', groupId, 'custom_script', config, maxParallel, hostIds, [])
}

export async function triggerServiceAction(
  currentScope: string,
  hostId: string,
  serviceName: string,
  action: 'start' | 'stop' | 'restart' | 'status',
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await requireInstanceAdminAccess(currentScope)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
  })
  if (!host) return { error: 'Host not found' }
  if (host.os?.toLowerCase() !== 'linux') {
    return { error: 'Service management is only supported on Linux hosts' }
  }

  const config: ServiceTaskConfig = { service_name: serviceName, action }
  return createTaskRun(currentScope, session.user.id, 'host', hostId, 'service', config, 1, [hostId], [])
}

export async function triggerGroupServiceAction(
  currentScope: string,
  groupId: string,
  serviceName: string,
  action: 'start' | 'stop' | 'restart' | 'status',
  maxParallel: number,
): Promise<
  { success: true; taskRunId: string; targetedCount: number; skippedCount: number } | { error: string }
> {
  const session = await requireInstanceAdminAccess(currentScope)
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.instanceId, currentScope),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { hostId: true },
  })
  if (members.length === 0) return { error: 'Group has no members' }

  const hostIds = members.map((m) => m.hostId)
  const groupHosts = await db.query.hosts.findMany({
    where: and(
      inArray(hosts.id, hostIds),
      eq(hosts.instanceId, currentScope),
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
    currentScope, session.user.id, 'group', groupId, 'service', config, maxParallel, pendingHostIds, skipHosts,
  )

  if ('error' in result) return result

  return {
    success: true,
    taskRunId: result.taskRunId,
    targetedCount: pendingHostIds.length,
    skippedCount: skipHosts.length,
  }
}

export async function triggerAgentUninstall(
  currentScope: string,
  hostId: string,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await requireInstanceAdminAccess(currentScope)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
  })
  if (!host) return { error: 'Host not found' }

  const config: AgentUninstallTaskConfig = {}
  return createTaskRun(currentScope, session.user.id, 'host', hostId, 'agent_uninstall', config, 1, [hostId], [])
}

export async function deleteTaskRuns(
  currentScope: string,
  taskRunIds: string[],
): Promise<{ success: true } | { error: string }> {
  await requireInstanceToolingAccess(currentScope)
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
            eq(taskRunHosts.instanceId, currentScope),
            isNull(taskRunHosts.deletedAt),
          ),
        )
      await tx
        .update(taskRuns)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(taskRuns.id, taskRunIds),
            eq(taskRuns.instanceId, currentScope),
            isNull(taskRuns.deletedAt),
          ),
        )
    })
    return { success: true }
  } catch (err) {
    logError('Failed to delete task runs:', err)
    return { error: 'Failed to delete task runs' }
  }
}

export async function triggerPatchRun(
  currentScope: string,
  hostId: string,
  mode: 'security' | 'all',
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await requireInstanceAdminAccess(currentScope)
  const host = await db.query.hosts.findFirst({
    where: and(
      eq(hosts.id, hostId),
      eq(hosts.instanceId, currentScope),
      isNull(hosts.deletedAt),
    ),
  })
  if (!host) return { error: 'Host not found' }
  if (host.os?.toLowerCase() !== 'linux') {
    return { error: 'Patch runs are only supported on Linux hosts' }
  }

  const config: PatchTaskConfig = { mode }
  return createTaskRun(currentScope, session.user.id, 'host', hostId, 'patch', config, 1, [hostId], [])
}

export async function triggerGroupPatchRun(
  currentScope: string,
  groupId: string,
  mode: 'security' | 'all',
  maxParallel: number,
): Promise<
  { success: true; taskRunId: string; targetedCount: number; skippedCount: number } | { error: string }
> {
  const session = await requireInstanceAdminAccess(currentScope)
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.instanceId, currentScope),
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
      eq(hosts.instanceId, currentScope),
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
    currentScope,
    session.user.id,
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
