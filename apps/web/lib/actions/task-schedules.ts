'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope, resolveOptionalActionScope } from './action-scope'
import {
  createSchedule as createScheduleCore,
  deleteSchedule as deleteScheduleCore,
  getSchedule as getScheduleCore,
  listSchedules as listSchedulesCore,
  previewCronRuns,
  runScheduleNow as runScheduleNowCore,
  setScheduleEnabled as setScheduleEnabledCore,
  updateSchedule as updateScheduleCore,
} from './task-schedules-core'
import type { ScheduleWithTargetName } from './task-schedules-types'

export { previewCronRuns }

export async function listSchedules(
  ...args: [] | [string]
): Promise<ScheduleWithTargetName[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveOptionalActionScope(session)
  if (!currentScope) return []
  return listSchedulesCore(currentScope)
}

export async function getSchedule(
  ...args: [string] | [string, string]
): Promise<Awaited<ReturnType<typeof getScheduleCore>>> {
  const session = await getRequiredSession()
  const [currentScope, scheduleId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getScheduleCore(currentScope, scheduleId)
}

export async function createSchedule(
  ...args: [unknown] | [string, unknown]
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, input] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return createScheduleCore(currentScope, input)
}

export async function updateSchedule(
  ...args: [string, unknown] | [string, string, unknown]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, scheduleId, input] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return updateScheduleCore(currentScope, scheduleId, input)
}

export async function setScheduleEnabled(
  ...args: [string, boolean] | [string, string, boolean]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, scheduleId, enabled] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return setScheduleEnabledCore(currentScope, scheduleId, enabled)
}

export async function deleteSchedule(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, scheduleId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteScheduleCore(currentScope, scheduleId)
}

export async function runScheduleNow(
  ...args: [string] | [string, string]
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, scheduleId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return runScheduleNowCore(currentScope, scheduleId)
}
