'use server'

import { logError } from '@/lib/logging'
import { requireOrgAccess } from '@/lib/actions/action-auth'

import { db } from '@/lib/db'
import { taskSchedules, taskRuns, hostGroups, hosts } from '@/lib/db/schema'
import { eq, and, isNull, desc, inArray } from 'drizzle-orm'
import { CronExpressionParser } from 'cron-parser'
import { MEMBERSHIP_ROLES } from '@/lib/auth/roles'
import { hasRole } from '@/lib/auth/guards'
import { z } from 'zod'
import type { TaskSchedule, TaskType, TaskConfig } from '@/lib/db/schema'
import {
  triggerPatchRun,
  triggerGroupPatchRun,
  triggerCustomScriptRun,
  triggerGroupCustomScriptRun,
  triggerServiceAction,
  triggerGroupServiceAction,
} from './task-runs'
import type { ScheduleWithTargetName } from './task-schedules-types'

// ── Zod schemas ───────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeNextRunAt(cronExpression: string, timezone: string, from: Date = new Date()): Date {
  const interval = CronExpressionParser.parse(cronExpression, { currentDate: from, tz: timezone })
  return interval.next().toDate()
}

/**
 * Returns up to `count` upcoming trigger times for a cron expression.
 * Used by the UI form preview. Throws on invalid cron.
 */
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
  orgId: string,
  targetType: 'host' | 'group',
  targetId: string,
): Promise<{ ok: true } | { error: string }> {
  if (targetType === 'host') {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, targetId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
      columns: { id: true },
    })
    if (!host) return { error: 'Host not found' }
    return { ok: true }
  }
  const group = await db.query.hostGroups.findFirst({
    where: and(eq(hostGroups.id, targetId), eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
    columns: { id: true },
  })
  if (!group) return { error: 'Host group not found' }
  return { ok: true }
}

// ── Read queries ──────────────────────────────────────────────────────────────

export async function listSchedules(orgId: string): Promise<ScheduleWithTargetName[]> {
  await requireOrgAccess(orgId)
  const rows = await db.query.taskSchedules.findMany({
    where: and(eq(taskSchedules.organisationId, orgId), isNull(taskSchedules.deletedAt)),
    orderBy: [desc(taskSchedules.createdAt)],
  })

  if (rows.length === 0) return []

  // Resolve target names in bulk
  const hostIds = rows.filter((r) => r.targetType === 'host').map((r) => r.targetId)
  const groupIds = rows.filter((r) => r.targetType === 'group').map((r) => r.targetId)

  const [hostRows, groupRows] = await Promise.all([
    hostIds.length
      ? db.query.hosts.findMany({
          where: and(
            inArray(hosts.id, hostIds),
            eq(hosts.organisationId, orgId),
            isNull(hosts.deletedAt),
          ),
          columns: { id: true, hostname: true },
        })
      : Promise.resolve([]),
    groupIds.length
      ? db.query.hostGroups.findMany({
          where: and(
            inArray(hostGroups.id, groupIds),
            eq(hostGroups.organisationId, orgId),
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
  orgId: string,
  id: string,
): Promise<{ schedule: TaskSchedule; recentRuns: Awaited<ReturnType<typeof recentRunsForSchedule>> } | null> {
  await requireOrgAccess(orgId)
  const schedule = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.organisationId, orgId),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!schedule) return null

  const recentRuns = await recentRunsForSchedule(orgId, id)
  return { schedule, recentRuns }
}

async function recentRunsForSchedule(orgId: string, scheduleId: string) {
  return db.query.taskRuns.findMany({
    where: and(
      eq(taskRuns.scheduledFromId, scheduleId),
      eq(taskRuns.organisationId, orgId),
      isNull(taskRuns.deletedAt),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 20,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createSchedule(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await requireOrgAccess(orgId)
  if (!hasRole(session.user, MEMBERSHIP_ROLES)) return { error: 'Insufficient permissions' }

  const parsed = scheduleInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  }

  const data = parsed.data
  const targetCheck = await verifyTargetExists(orgId, data.targetType, data.targetId)
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
        organisationId: orgId,
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
  orgId: string,
  id: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const session = await requireOrgAccess(orgId)
  if (!hasRole(session.user, MEMBERSHIP_ROLES)) return { error: 'Insufficient permissions' }

  const existing = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.organisationId, orgId),
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

  const targetCheck = await verifyTargetExists(orgId, data.targetType, data.targetId)
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
  orgId: string,
  id: string,
  enabled: boolean,
): Promise<{ success: true } | { error: string }> {
  const session = await requireOrgAccess(orgId)
  if (!hasRole(session.user, MEMBERSHIP_ROLES)) return { error: 'Insufficient permissions' }

  const existing = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.organisationId, orgId),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!existing) return { error: 'Schedule not found' }

  // When re-enabling, recompute next_run_at from now.
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
  orgId: string,
  id: string,
): Promise<{ success: true } | { error: string }> {
  const session = await requireOrgAccess(orgId)
  if (!hasRole(session.user, MEMBERSHIP_ROLES)) return { error: 'Insufficient permissions' }

  try {
    await db
      .update(taskSchedules)
      .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(taskSchedules.id, id),
          eq(taskSchedules.organisationId, orgId),
          isNull(taskSchedules.deletedAt),
        ),
      )
    return { success: true }
  } catch (err) {
    logError('Failed to delete schedule:', err)
    return { error: 'Failed to delete schedule' }
  }
}

/**
 * Triggers an immediate task_run from a schedule by dispatching to the
 * matching trigger* helper. Does not advance next_run_at — the sweeper
 * handles the scheduled cadence separately.
 */
export async function runScheduleNow(
  orgId: string,
  id: string,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await requireOrgAccess(orgId)
  if (!hasRole(session.user, MEMBERSHIP_ROLES)) return { error: 'Insufficient permissions' }

  const schedule = await db.query.taskSchedules.findFirst({
    where: and(
      eq(taskSchedules.id, id),
      eq(taskSchedules.organisationId, orgId),
      isNull(taskSchedules.deletedAt),
    ),
  })
  if (!schedule) return { error: 'Schedule not found' }

  const userId = session.user.id
  const { taskType, targetType, targetId, maxParallel, config } = schedule

  if (taskType === 'patch') {
    const mode = (config as { mode: 'security' | 'all' }).mode
    return targetType === 'host'
      ? triggerPatchRun(orgId, userId, targetId, mode)
      : (async () => {
          const r = await triggerGroupPatchRun(orgId, userId, targetId, mode, maxParallel)
          if ('error' in r) return r
          return { success: true as const, taskRunId: r.taskRunId }
        })()
  }
  if (taskType === 'custom_script') {
    const c = config as { script: string; interpreter: 'sh' | 'bash' | 'python3'; timeout_seconds?: number }
    return targetType === 'host'
      ? triggerCustomScriptRun(orgId, userId, targetId, c.script, c.interpreter, c.timeout_seconds)
      : triggerGroupCustomScriptRun(orgId, userId, targetId, c.script, c.interpreter, maxParallel, c.timeout_seconds)
  }
  if (taskType === 'service') {
    const c = config as { service_name: string; action: 'start' | 'stop' | 'restart' | 'status' }
    return targetType === 'host'
      ? triggerServiceAction(orgId, userId, targetId, c.service_name, c.action)
      : (async () => {
          const r = await triggerGroupServiceAction(orgId, userId, targetId, c.service_name, c.action, maxParallel)
          if ('error' in r) return r
          return { success: true as const, taskRunId: r.taskRunId }
        })()
  }
  if (taskType === 'software_inventory') {
    return { error: 'Software inventory runs are managed by the system sweeper and cannot be triggered manually from a schedule' }
  }
  return { error: `Unsupported task type: ${taskType}` }
}
