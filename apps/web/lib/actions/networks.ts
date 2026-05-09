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
  ...args: [string] | [string, string]
): Promise<(import('@/lib/db/schema').Network & { members: import('@/lib/db/schema').Host[] }) | null> {
  const session = await getRequiredSession()
  const [currentScope, networkId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getNetworkCore(currentScope, networkId)
}

export async function createNetwork(
  ...args:
    | [{ name: string; cidr: string; description?: string }]
    | [string, { name: string; cidr: string; description?: string }]
): Promise<{ success: true; network: import('@/lib/db/schema').Network } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, data] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return createNetworkCore(currentScope, data)
}

export async function updateNetwork(
  ...args:
    | [string, { name: string; cidr: string; description?: string }]
    | [string, string, { name: string; cidr: string; description?: string }]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, networkId, data] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return updateNetworkCore(currentScope, networkId, data)
}

export async function deleteNetwork(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, networkId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteNetworkCore(currentScope, networkId)
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
  ...args: [string] | [string, string]
): Promise<import('@/lib/db/schema').Host[]> {
  const session = await getRequiredSession()
  const [currentScope, networkId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listHostsInNetworkCore(currentScope, networkId)
}

export async function listMembershipsForNetwork(
  ...args: [string] | [string, string]
): Promise<NetworkMembershipEntry[]> {
  const session = await getRequiredSession()
  const [currentScope, networkId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listMembershipsForNetworkCore(currentScope, networkId)
}

export async function listNetworksWithHosts(
  ...args: [] | [string]
): Promise<NetworkWithHosts[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listNetworksWithHostsCore(currentScope)
}

export async function listNetworksForHost(
  ...args: [string] | [string, string]
): Promise<NetworkWithMembership[]> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listNetworksForHostCore(currentScope, hostId)
}
