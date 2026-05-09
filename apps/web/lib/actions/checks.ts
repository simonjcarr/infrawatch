'use server'

import { getRequiredSession } from '@/lib/auth/session'
import {
  createCheck as createCheckCore,
  deleteCheck as deleteCheckCore,
  deleteCheckHistory as deleteCheckHistoryCore,
  getChecksWithHistory as getChecksWithHistoryCore,
  updateCheck as updateCheckCore,
  type CheckWithHistory,
} from './checks-core'
import { resolveCurrentActionScope } from './action-scope'

export type { CheckWithHistory } from './checks-core'

export async function getChecksWithHistory(
  ...args: [string] | [string, string]
): Promise<CheckWithHistory[]> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getChecksWithHistoryCore(currentScope, hostId)
}

export async function createCheck(
  ...args: [unknown] | [string, unknown]
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, input] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return createCheckCore(currentScope, input)
}

export async function updateCheck(
  ...args: [string, unknown] | [string, string, unknown]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, checkId, input] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return updateCheckCore(currentScope, checkId, input)
}

export async function deleteCheckHistory(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, checkId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteCheckHistoryCore(currentScope, checkId)
}

export async function deleteCheck(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, checkId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteCheckCore(currentScope, checkId)
}
