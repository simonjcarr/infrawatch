'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  cancelTaskRun as cancelTaskRunCore,
  deleteTaskRuns as deleteTaskRunsCore,
  getTaskRun as getTaskRunCore,
  listAutomatedRunsForHost as listAutomatedRunsForHostCore,
  listTaskRunsForGroup as listTaskRunsForGroupCore,
  listTaskRunsForHost as listTaskRunsForHostCore,
  triggerAgentUninstall as triggerAgentUninstallCore,
  triggerCustomScriptRun as triggerCustomScriptRunCore,
  triggerGroupCustomScriptRun as triggerGroupCustomScriptRunCore,
  triggerGroupPatchRun as triggerGroupPatchRunCore,
  triggerGroupServiceAction as triggerGroupServiceActionCore,
  triggerPatchRun as triggerPatchRunCore,
  triggerServiceAction as triggerServiceActionCore,
  type TaskRunWithHosts,
} from './task-runs-core'

export type { TaskRunHostWithHost, TaskRunWithHosts } from './task-runs-core'

const TASK_TYPES = new Set(['patch', 'custom_script', 'service', 'agent_uninstall', 'software_inventory'])

function isTaskType(value: string | undefined): value is string {
  return value !== undefined && TASK_TYPES.has(value)
}

export async function getTaskRun(
  ...args: [string] | [string, string]
): Promise<TaskRunWithHosts | null> {
  const session = await getRequiredSession()
  const [currentScope, taskRunId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getTaskRunCore(currentScope, taskRunId)
}

export async function listTaskRunsForHost(
  ...args: [string] | [string, string] | [string, string, string]
): Promise<TaskRunWithHosts[]> {
  const session = await getRequiredSession()
  if (args.length === 1) return listTaskRunsForHostCore(resolveCurrentActionScope(session), args[0])
  if (args.length === 2) {
    return isTaskType(args[1])
      ? listTaskRunsForHostCore(resolveCurrentActionScope(session), args[0], args[1])
      : listTaskRunsForHostCore(args[0], args[1])
  }
  return listTaskRunsForHostCore(args[0], args[1], args[2])
}

export async function listAutomatedRunsForHost(
  ...args: [string] | [string, string] | [string, string, string]
): Promise<TaskRunWithHosts[]> {
  const session = await getRequiredSession()
  if (args.length === 1) return listAutomatedRunsForHostCore(resolveCurrentActionScope(session), args[0])
  if (args.length === 2) {
    return isTaskType(args[1])
      ? listAutomatedRunsForHostCore(resolveCurrentActionScope(session), args[0], args[1])
      : listAutomatedRunsForHostCore(args[0], args[1])
  }
  return listAutomatedRunsForHostCore(args[0], args[1], args[2])
}

export async function listTaskRunsForGroup(
  ...args: [string] | [string, string] | [string, string, string]
): Promise<TaskRunWithHosts[]> {
  const session = await getRequiredSession()
  if (args.length === 1) return listTaskRunsForGroupCore(resolveCurrentActionScope(session), args[0])
  if (args.length === 2) {
    return isTaskType(args[1])
      ? listTaskRunsForGroupCore(resolveCurrentActionScope(session), args[0], args[1])
      : listTaskRunsForGroupCore(args[0], args[1])
  }
  return listTaskRunsForGroupCore(args[0], args[1], args[2])
}

export async function cancelTaskRun(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, taskRunId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return cancelTaskRunCore(currentScope, taskRunId)
}

export async function triggerCustomScriptRun(
  ...args:
    | [string, string, 'sh' | 'bash' | 'python3', number?]
    | [string, string, string, 'sh' | 'bash' | 'python3', number?]
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  if (args.length >= 4 && (args[2] === 'sh' || args[2] === 'bash' || args[2] === 'python3')) {
    const [hostId, script, interpreter, timeoutSeconds] = args as [string, string, 'sh' | 'bash' | 'python3', number?]
    return triggerCustomScriptRunCore(resolveCurrentActionScope(session), hostId, script, interpreter, timeoutSeconds)
  }
  const [currentScope, hostId, script, interpreter, timeoutSeconds] = args as [string, string, string, 'sh' | 'bash' | 'python3', number?]
  return triggerCustomScriptRunCore(currentScope, hostId, script, interpreter, timeoutSeconds)
}

export async function triggerGroupCustomScriptRun(
  ...args:
    | [string, string, 'sh' | 'bash' | 'python3', number, number?]
    | [string, string, string, 'sh' | 'bash' | 'python3', number, number?]
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  if (args.length >= 5 && (args[2] === 'sh' || args[2] === 'bash' || args[2] === 'python3')) {
    const [groupId, script, interpreter, maxParallel, timeoutSeconds] = args as [string, string, 'sh' | 'bash' | 'python3', number, number?]
    return triggerGroupCustomScriptRunCore(resolveCurrentActionScope(session), groupId, script, interpreter, maxParallel, timeoutSeconds)
  }
  const [currentScope, groupId, script, interpreter, maxParallel, timeoutSeconds] = args as [string, string, string, 'sh' | 'bash' | 'python3', number, number?]
  return triggerGroupCustomScriptRunCore(currentScope, groupId, script, interpreter, maxParallel, timeoutSeconds)
}

export async function triggerServiceAction(
  ...args:
    | [string, string, 'start' | 'stop' | 'restart' | 'status']
    | [string, string, string, 'start' | 'stop' | 'restart' | 'status']
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  if (args.length === 3) {
    const [hostId, serviceName, action] = args
    return triggerServiceActionCore(resolveCurrentActionScope(session), hostId, serviceName, action)
  }
  const [currentScope, hostId, serviceName, action] = args
  return triggerServiceActionCore(currentScope, hostId, serviceName, action)
}

export async function triggerGroupServiceAction(
  ...args:
    | [string, string, 'start' | 'stop' | 'restart' | 'status', number]
    | [string, string, string, 'start' | 'stop' | 'restart' | 'status', number]
): Promise<
  { success: true; taskRunId: string; targetedCount: number; skippedCount: number } | { error: string }
> {
  const session = await getRequiredSession()
  if (args.length === 4) {
    const [groupId, serviceName, action, maxParallel] = args
    return triggerGroupServiceActionCore(resolveCurrentActionScope(session), groupId, serviceName, action, maxParallel)
  }
  const [currentScope, groupId, serviceName, action, maxParallel] = args
  return triggerGroupServiceActionCore(currentScope, groupId, serviceName, action, maxParallel)
}

export async function triggerAgentUninstall(
  ...args: [string] | [string, string]
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return triggerAgentUninstallCore(currentScope, hostId)
}

export async function deleteTaskRuns(
  ...args: [string[]] | [string, string[]]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, taskRunIds] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteTaskRunsCore(currentScope, taskRunIds)
}

export async function triggerPatchRun(
  ...args: [string, 'security' | 'all'] | [string, string, 'security' | 'all']
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  if (args.length === 2) {
    const [hostId, mode] = args
    return triggerPatchRunCore(resolveCurrentActionScope(session), hostId, mode)
  }
  const [currentScope, hostId, mode] = args
  return triggerPatchRunCore(currentScope, hostId, mode)
}

export async function triggerGroupPatchRun(
  ...args: [string, 'security' | 'all', number] | [string, string, 'security' | 'all', number]
): Promise<
  { success: true; taskRunId: string; targetedCount: number; skippedCount: number } | { error: string }
> {
  const session = await getRequiredSession()
  if (args.length === 3) {
    const [groupId, mode, maxParallel] = args
    return triggerGroupPatchRunCore(resolveCurrentActionScope(session), groupId, mode, maxParallel)
  }
  const [currentScope, groupId, mode, maxParallel] = args
  return triggerGroupPatchRunCore(currentScope, groupId, mode, maxParallel)
}
