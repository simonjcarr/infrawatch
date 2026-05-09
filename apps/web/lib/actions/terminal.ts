'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  checkTerminalAccess as checkTerminalAccessCore,
  createTerminalSession as createTerminalSessionCore,
  type HostTerminalSettings,
  type OrgTerminalSettings,
  type TerminalAccessDenied,
  type TerminalAccessResult,
} from './terminal-core'

export * from './terminal-core'

export type {
  HostTerminalSettings,
  OrgTerminalSettings,
  TerminalAccessDenied,
  TerminalAccessResult,
}

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
