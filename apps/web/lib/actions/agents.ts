'use server'

import { getRequiredSession } from '@/lib/auth/session'
import type { Agent } from '@/lib/db/schema'
import {
  listPendingAgents as listPendingAgentsCore,
  approveAgent as approveAgentCore,
  rejectAgent as rejectAgentCore,
  listHosts as listHostsCore,
  listHostsPaginated as listHostsPaginatedCore,
  getHostInventoryStats as getHostInventoryStatsCore,
  listDistinctHostOses as listDistinctHostOsesCore,
  type HostListParams,
  type HostListResult,
  type HostInventoryStats,
  type HostWithAgent,
} from './agents-core'
import { resolveCurrentActionScope } from './action-scope'

export * from './agents-core'

export async function listPendingAgents(...args: [] | [string]): Promise<Agent[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listPendingAgentsCore(currentScope)
}

export async function approveAgent(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, agentId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return approveAgentCore(currentScope, agentId)
}

export async function rejectAgent(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, agentId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return rejectAgentCore(currentScope, agentId)
}

export async function listHosts(...args: [] | [string]): Promise<HostWithAgent[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listHostsCore(currentScope)
}

export async function listHostsPaginated(
  ...args: [HostListParams?] | [string, HostListParams?]
): Promise<HostListResult> {
  const session = await getRequiredSession()
  const currentScope = args.length === 2 ? args[0] : resolveCurrentActionScope(session)
  const params: HostListParams | undefined =
    args.length === 2 ? args[1] : args[0] as HostListParams | undefined
  return listHostsPaginatedCore(currentScope, params)
}

export async function getHostInventoryStats(...args: [] | [string]): Promise<HostInventoryStats> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return getHostInventoryStatsCore(currentScope)
}

export async function listDistinctHostOses(...args: [] | [string]): Promise<string[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listDistinctHostOsesCore(currentScope)
}
