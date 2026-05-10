'use server'

import { getRequiredSession } from '@/lib/auth/session'
import type { Agent } from '@/lib/db/schema'
import {
  createEnrolmentToken as createEnrolmentTokenCore,
  deleteHost as deleteHostCore,
  getHeartbeatHistory as getHeartbeatHistoryCore,
  getHost as getHostCore,
  listPendingAgents as listPendingAgentsCore,
  approveAgent as approveAgentCore,
  rejectAgent as rejectAgentCore,
  listHosts as listHostsCore,
  listHostsPaginated as listHostsPaginatedCore,
  getHostInventoryStats as getHostInventoryStatsCore,
  getHostMetrics as getHostMetricsCore,
  listDistinctHostOses as listDistinctHostOsesCore,
  listEnrolmentTokens as listEnrolmentTokensCore,
  revokeEnrolmentToken as revokeEnrolmentTokenCore,
  uninstallAndDeleteHost as uninstallAndDeleteHostCore,
  type EnrolmentTokenSafe,
  type HeartbeatPoint,
  type HostListParams,
  type HostListResult,
  type HostInventoryStats,
  type HostWithAgent,
  type MetricsQuery,
} from './agents-core'
import { resolveCurrentActionScope } from './action-scope'

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

export async function createEnrolmentToken(
  input: {
    label: string
    autoApprove: boolean
    skipVerify?: boolean
    maxUses?: number
    expiresInDays?: number
    tags?: Array<{ key: string; value: string }>
  },
): Promise<{ token: string; id: string } | { error: string }> {
  const session = await getRequiredSession()
  return createEnrolmentTokenCore(resolveCurrentActionScope(session), input)
}

export async function listEnrolmentTokens(): Promise<EnrolmentTokenSafe[]> {
  const session = await getRequiredSession()
  return listEnrolmentTokensCore(resolveCurrentActionScope(session))
}

export async function revokeEnrolmentToken(
  tokenId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  return revokeEnrolmentTokenCore(resolveCurrentActionScope(session), tokenId)
}

export async function getHostMetrics(
  ...args: [string, MetricsQuery] | [string, string, MetricsQuery]
) {
  const session = await getRequiredSession()
  const currentScope = args.length === 3 ? args[0] : resolveCurrentActionScope(session)
  const hostId = args.length === 3 ? args[1] : args[0]
  const query = args.length === 3 ? args[2] : args[1]
  return getHostMetricsCore(currentScope, hostId, query)
}

export async function getHeartbeatHistory(
  ...args: [string, MetricsQuery] | [string, string, MetricsQuery]
): Promise<HeartbeatPoint[]> {
  const session = await getRequiredSession()
  const currentScope = args.length === 3 ? args[0] : resolveCurrentActionScope(session)
  const hostId = args.length === 3 ? args[1] : args[0]
  const query = args.length === 3 ? args[2] : args[1]
  return getHeartbeatHistoryCore(currentScope, hostId, query)
}

export async function getHost(...args: [string] | [string, string]): Promise<HostWithAgent | null> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getHostCore(currentScope, hostId)
}

export async function deleteHost(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteHostCore(currentScope, hostId)
}

export async function uninstallAndDeleteHost(
  ...args: [string] | [string, string]
): Promise<
  | { success: true }
  | { error: string; taskRunId?: string; agentOffline?: boolean }
> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return uninstallAndDeleteHostCore(currentScope, hostId)
}
