'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  checkTerminalAccess as checkTerminalAccessCore,
  createTerminalSession as createTerminalSessionCore,
  getOrgTerminalSettings as getOrgTerminalSettingsCore,
  getHostTerminalSettings as getHostTerminalSettingsCore,
  type HostTerminalSettings,
  type OrgTerminalSettings,
  type TerminalAccessDenied,
  type TerminalAccessResult,
  trustPendingSshHostKeys as trustPendingSshHostKeysCore,
  updateHostTerminalSettings as updateHostTerminalSettingsCore,
  updateOrgTerminalSettings as updateOrgTerminalSettingsCore,
} from './terminal-core'

export async function checkTerminalAccess(
  ...args: [string] | [string, string]
): Promise<TerminalAccessResult | TerminalAccessDenied> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return checkTerminalAccessCore(currentScope, hostId)
}

export async function createTerminalSession(
  ...args: [string, string?] | [string, string, string?]
): Promise<{ sessionId: string; ingestWsUrl: string; websocketToken: string } | { error: string }> {
  const session = await getRequiredSession()
  let currentScope: string
  let hostId: string
  let username: string | undefined

  if (args.length >= 3) {
    currentScope = args[0]
    hostId = args[1]!
    username = args[2]
  } else {
    currentScope = resolveCurrentActionScope(session)
    hostId = args[0]
    username = args[1]
  }

  return createTerminalSessionCore(currentScope, hostId, username)
}

export async function getOrgTerminalSettings(
  scopeId: string,
): Promise<OrgTerminalSettings> {
  return getOrgTerminalSettingsCore(scopeId)
}

export async function updateOrgTerminalSettings(
  scopeId: string,
  settings: OrgTerminalSettings,
): Promise<{ success: true } | { error: string }> {
  return updateOrgTerminalSettingsCore(scopeId, settings)
}

export async function getHostTerminalSettings(
  scopeId: string,
  hostId: string,
): Promise<HostTerminalSettings> {
  return getHostTerminalSettingsCore(scopeId, hostId)
}

export async function updateHostTerminalSettings(
  scopeId: string,
  hostId: string,
  settings: HostTerminalSettings,
): Promise<{ success: true } | { error: string }> {
  return updateHostTerminalSettingsCore(scopeId, hostId, settings)
}

export async function trustPendingSshHostKeys(
  scopeId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  return trustPendingSshHostKeysCore(scopeId, hostId)
}
