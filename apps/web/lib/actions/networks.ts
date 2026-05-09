'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  addHostToNetwork as addHostToNetworkCore,
  createNetwork as createNetworkCore,
  deleteNetwork as deleteNetworkCore,
  getNetwork as getNetworkCore,
  listHostsInNetwork as listHostsInNetworkCore,
  listMembershipsForNetwork as listMembershipsForNetworkCore,
  listNetworks as listNetworksCore,
  listNetworksForHost as listNetworksForHostCore,
  listNetworksWithHosts as listNetworksWithHostsCore,
  removeHostFromNetwork as removeHostFromNetworkCore,
  updateNetwork as updateNetworkCore,
  type NetworkMembershipEntry,
  type NetworkWithCount,
  type NetworkWithHosts,
  type NetworkWithMembership,
} from './networks-core'

export type {
  NetworkMembershipEntry,
  NetworkWithCount,
  NetworkWithHosts,
  NetworkWithMembership,
} from './networks-core'

export async function listNetworks(
  ...args: [] | [string]
): Promise<NetworkWithCount[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listNetworksCore(currentScope)
}

export async function getNetwork(
  scopeId: string,
  networkId: string,
): Promise<(import('@/lib/db/schema').Network & { members: import('@/lib/db/schema').Host[] }) | null> {
  return getNetworkCore(scopeId, networkId)
}

export async function createNetwork(
  scopeId: string,
  data: { name: string; cidr: string; description?: string },
): Promise<{ success: true; network: import('@/lib/db/schema').Network } | { error: string }> {
  return createNetworkCore(scopeId, data)
}

export async function updateNetwork(
  scopeId: string,
  networkId: string,
  data: { name: string; cidr: string; description?: string },
): Promise<{ success: true } | { error: string }> {
  return updateNetworkCore(scopeId, networkId, data)
}

export async function deleteNetwork(
  scopeId: string,
  networkId: string,
): Promise<{ success: true } | { error: string }> {
  return deleteNetworkCore(scopeId, networkId)
}

export async function addHostToNetwork(
  ...args: [string, string] | [string, string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, networkId, hostId] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return addHostToNetworkCore(currentScope, networkId, hostId)
}

export async function removeHostFromNetwork(
  ...args: [string, string] | [string, string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, networkId, hostId] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return removeHostFromNetworkCore(currentScope, networkId, hostId)
}

export async function listHostsInNetwork(
  scopeId: string,
  networkId: string,
): Promise<import('@/lib/db/schema').Host[]> {
  return listHostsInNetworkCore(scopeId, networkId)
}

export async function listMembershipsForNetwork(
  scopeId: string,
  networkId: string,
): Promise<NetworkMembershipEntry[]> {
  return listMembershipsForNetworkCore(scopeId, networkId)
}

export async function listNetworksWithHosts(
  scopeId: string,
): Promise<NetworkWithHosts[]> {
  return listNetworksWithHostsCore(scopeId)
}

export async function listNetworksForHost(
  ...args: [string] | [string, string]
): Promise<NetworkWithMembership[]> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listNetworksForHostCore(currentScope, hostId)
}
