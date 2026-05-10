'use server'

import { logError } from '@/lib/logging'
import { requireInstanceAdminAccess, requireInstanceToolingAccess } from '@/lib/actions/action-auth'

import { db } from '@/lib/db'
import { taskSchedules, taskRuns, hostGroups, hosts } from '@/lib/db/schema'
import { eq, and, isNull, desc, inArray } from 'drizzle-orm'
import { CronExpressionParser } from 'cron-parser'
import { z } from 'zod'
import type { TaskSchedule, TaskType, TaskConfig } from '@/lib/db/schema'
import {
  triggerPatchRun,
  triggerGroupPatchRun,
  triggerCustomScriptRun,
  triggerGroupCustomScriptRun,
  triggerServiceAction,
  triggerGroupServiceAction,
} from './task-runs-core'
import type { ScheduleWithTargetName } from './task-schedules-types'

const patchConfigSchema = z.object({
  mode: z.enum(['security', 'all']),
})

const customScriptConfigSchema = z.object({
  script: z.string().min(1, 'Script is required'),
  interpreter: z.enum(['sh', 'bash', 'python3']),
  timeout_seconds: z.number().int().positive().optional(),
})

const serviceConfigSchema = z.object({
  service_name: z.string().min(1, 'Service name is required'),
  action: z.enum(['start', 'stop', 'restart', 'status']),
})

const softwareInventoryConfigSchema = z.object({}).strict()

const scheduleInputBase = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).optional().nullable(),
  targetType: z.enum(['host', 'group']),
  targetId: z.string().min(1),
  maxParallel: z.number().int().min(0).max(100).default(1),
  cronExpression: z.string().min(1),
  timezone: z.string().min(1).default('UTC'),
  enabled: z.boolean().default(true),
})

const scheduleInputSchema = z.discriminatedUnion('taskType', [
  scheduleInputBase.extend({ taskType: z.literal('patch'), config: patchConfigSchema }),
  scheduleInputBase.extend({ taskType: z.literal('custom_script'), config: customScriptConfigSchema }),
  scheduleInputBase.extend({ taskType: z.literal('service'), config: serviceConfigSchema }),
  scheduleInputBase.extend({ taskType: z.literal('software_inventory'), config: softwareInventoryConfigSchema }),
])

export type ScheduleInput = z.infer<typeof scheduleInputSchema>

function computeNextRunAt(cronExpression: string, timezone: string, from: Date = new Date()): Date {
  const interval = CronExpressionParser.parse(cronExpression, { currentDate: from, tz: timezone })
  return interval.next().toDate()
}

export async function previewCronRuns(
  cronExpression: string,
  timezone: string,
  count = 5,
): Promise<{ runs: string[] } | { error: string }> {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone })
    const runs: string[] = []
    for (let i = 0; i < count; i++) {
      runs.push(interval.next().toDate().toISOString())
    }
    return { runs }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid cron expression' }
  }
}

async function verifyTargetExists(
  currentScope: string,
  targetType: 'host' | 'group',
  targetId: string,
): Promise<{ ok: true } | { error: string }> {
  if (targetType === 'host') {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, targetId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
      columns: { id: true },
    })
    if (!host) return { error: 'Host not found' }
    return { ok: true }
  }
  const group = await db.query.hostGroups.findFirst({
    where: and(eq(hostGroups.id, targetId), eq(hostGroups.instanceId, currentScope), isNull(hostGroups.deletedAt)),
    columns: { id: true },
  })
  if (!group) return { error: 'Host group not found' }
  return { ok: true }
}

export async function listSchedules(currentScope: string): Promise<ScheduleWithTargetName[]> {
  await requireInstanceToolingAccess(currentScope)
  const rows = await db.query.taskSchedules.findMany({
    where: and(eq(taskSchedules.instanceId, currentScope), isNull(taskSchedules.deletedAt)),
    orderBy: [desc(taskSchedules.createdAt)],
  })

  if (rows.length === 0) return []

  const hostIds = rows.filter((r) => r.targetType === 'host').map((r) => r.targetId)
  const groupIds = rows.filter((r) => r.targetType === 'group').map((r) => r.targetId)

  const [hostRows, groupRows] = await Promise.all([
    hostIds.length
      ? db.query.hosts.findMany({
          where: and(
            inArray(hosts.id, hostIds),
            eq(hosts.instanceId, currentScope),
            isNull(hosts.deletedAt),
          ),
          columns: { id: true, hostname: true },
        })
      : Promise.resolve([]),
    groupIds.length
      ? db.query.hostGroups.findMany({
          where: and(
            inArray(hostGroups.id, groupIds),
            eq(hostGroups.instanceId, currentScope),
            isNull(hostGroups.deletedAt),
          ),
          columns: { id: true, name: true },
        })
      : Promise.resolve([]),
  ])

  const hostMap = new Map(hostRows.map((h) => [h.id, h.hostname]))
  const groupMap = new Map(groupRows.map((g) => [g.id, g.name]))

  return rows.map((r) => ({
    ...r,
    targetName: r.targetType === 'host' ? hostMap.get(r.targetId) ?? null : groupMap.get(r.targetId) ?? null,
  }))
}

export async function getSchedule(
  currentScope: string,
  id: string,
): Promise<{ schedule: TaskSchedule; recentRuns: Awaited<ReturnType<typeof recentRunsForSchedule>> } | null> {
  await requireInstanceToolingAccess(currentScope)
  const schedule = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.instanceId, currentScope),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!schedule) return null

  const recentRuns = await recentRunsForSchedule(currentScope, id)
  return { schedule, recentRuns }
}

async function recentRunsForSchedule(currentScope: string, scheduleId: string) {
  return db.query.taskRuns.findMany({
    where: and(
      eq(taskRuns.scheduledFromId, scheduleId),
      eq(taskRuns.instanceId, currentScope),
      isNull(taskRuns.deletedAt),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 20,
  })
}

export async function createSchedule(
  currentScope: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await requireInstanceAdminAccess(currentScope)

  const parsed = scheduleInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }

  const data = parsed.data
  const targetCheck = await verifyTargetExists(currentScope, data.targetType, data.targetId)
  if ('error' in targetCheck) return targetCheck

  let nextRunAt: Date
  try {
    nextRunAt = computeNextRunAt(data.cronExpression, data.timezone)
  } catch (err) {
    return { error: err instanceof Error ? `Invalid cron: ${err.message}` : 'Invalid cron expression' }
  }

  try {
    const [row] = await db
      .insert(taskSchedules)
      .values({
        instanceId: currentScope,
        createdBy: session.user.id,
        name: data.name,
        description: data.description ?? null,
        taskType: data.taskType as TaskType,
        config: data.config as TaskConfig,
        targetType: data.targetType,
        targetId: data.targetId,
        maxParallel: data.maxParallel,
        cronExpression: data.cronExpression,
        timezone: data.timezone,
        enabled: data.enabled,
        nextRunAt,
      })
      .returning({ id: taskSchedules.id })

    if (!row) return { error: 'Failed to create schedule' }
    return { success: true, id: row.id }
  } catch (err) {
    logError('Failed to create schedule:', err)
    return { error: 'Failed to create schedule' }
  }
}

export async function updateSchedule(
  currentScope: string,
  id: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  await requireInstanceAdminAccess(currentScope)

  const existing = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.instanceId, currentScope),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Schedule not found' }

  const parsed = scheduleInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const data = parsed.data

  if (data.taskType !== existing.taskType) {
    return { error: 'Task type cannot be changed — delete and recreate the schedule' }
  }

  const targetCheck = await verifyTargetExists(currentScope, data.targetType, data.targetId)
  if ('error' in targetCheck) return targetCheck

  let nextRunAt: Date
  try {
    nextRunAt = computeNextRunAt(data.cronExpression, data.timezone)
  } catch (err) {
    return { error: err instanceof Error ? `Invalid cron: ${err.message}` : 'Invalid cron expression' }
  }

  try {
    await db
      .update(taskSchedules)
      .set({
        name: data.name,
        description: data.description ?? null,
        config: data.config as TaskConfig,
        targetType: data.targetType,
        targetId: data.targetId,
        maxParallel: data.maxParallel,
        cronExpression: data.cronExpression,
        timezone: data.timezone,
        enabled: data.enabled,
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(taskSchedules.id, id))
    return { success: true }
  } catch (err) {
    logError('Failed to update schedule:', err)
    return { error: 'Failed to update schedule' }
  }
}

export async function setScheduleEnabled(
  currentScope: string,
  id: string,
  enabled: boolean,
): Promise<{ success: true } | { error: string }> {
  await requireInstanceAdminAccess(currentScope)

  const existing = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.instanceId, currentScope),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Schedule not found' }

  let nextRunAt = existing.nextRunAt
  if (enabled) {
    try {
      nextRunAt = computeNextRunAt(existing.cronExpression, existing.timezone)
    } catch {
      return { error: 'Schedule has an invalid cron expression — edit to fix' }
    }
  }

  try {
    await db
      .update(taskSchedules)
      .set({ enabled, nextRunAt, updatedAt: new Date() })
      .where(eq(taskSchedules.id, id))
    return { success: true }
  } catch (err) {
    logError('Failed to toggle schedule:', err)
    return { error: 'Failed to update schedule' }
  }
}

export async function deleteSchedule(
  currentScope: string,
  id: string,
): Promise<{ success: true } | { error: string }> {
  await requireInstanceAdminAccess(currentScope)

  try {
    await db
      .update(taskSchedules)
      .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(taskSchedules.id, id),
          eq(taskSchedules.instanceId, currentScope),
          isNull(taskSchedules.deletedAt),
        ),
      )
    return { success: true }
  } catch (err) {
    logError('Failed to delete schedule:', err)
    return { error: 'Failed to delete schedule' }
  }
}

export async function runScheduleNow(
  currentScope: string,
  id: string,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  await requireInstanceAdminAccess(currentScope)

  const schedule = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.instanceId, currentScope),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!schedule) return { error: 'Schedule not found' }

  const { taskType, targetType, targetId, maxParallel, config } = schedule

  if (taskType === 'patch') {
    const mode = (config as { mode: 'security' | 'all' }).mode
    return targetType === 'host'
      ? triggerPatchRun(currentScope, targetId, mode)
      : (async () => {
          const result = await triggerGroupPatchRun(currentScope, targetId, mode, maxParallel)
          if ('error' in result) return result
          return { success: true as const, taskRunId: result.taskRunId }
        })()
  }
  if (taskType === 'custom_script') {
    const scheduleConfig = config as { script: string; interpreter: 'sh' | 'bash' | 'python3'; timeout_seconds?: number }
    return targetType === 'host'
      ? triggerCustomScriptRun(currentScope, targetId, scheduleConfig.script, scheduleConfig.interpreter, scheduleConfig.timeout_seconds)
      : triggerGroupCustomScriptRun(currentScope, targetId, scheduleConfig.script, scheduleConfig.interpreter, maxParallel, scheduleConfig.timeout_seconds)
  }
  if (taskType === 'service') {
    const scheduleConfig = config as { service_name: string; action: 'start' | 'stop' | 'restart' | 'status' }
    return targetType === 'host'
      ? triggerServiceAction(currentScope, targetId, scheduleConfig.service_name, scheduleConfig.action)
      : (async () => {
          const result = await triggerGroupServiceAction(currentScope, targetId, scheduleConfig.service_name, scheduleConfig.action, maxParallel)
          if ('error' in result) return result
          return { success: true as const, taskRunId: result.taskRunId }
        })()
  }
  if (taskType === 'software_inventory') {
    return { error: 'Software inventory runs are managed by the system sweeper and cannot be triggered manually from a schedule' }
  }
  return { error: `Unsupported task type: ${taskType}` }
}
