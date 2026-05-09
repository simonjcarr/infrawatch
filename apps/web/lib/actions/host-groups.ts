'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  addHostToGroup as addHostToGroupCore,
  createGroup as createGroupCore,
  deleteGroup as deleteGroupCore,
  getGroup as getGroupCore,
  listGroups as listGroupsCore,
  listGroupsForHost as listGroupsForHostCore,
  listHostsInGroup as listHostsInGroupCore,
  removeHostFromGroup as removeHostFromGroupCore,
  updateGroup as updateGroupCore,
  type HostGroupWithCount,
  type HostGroupWithMembers,
} from './host-groups-core'

export type { HostGroupWithCount, HostGroupWithMembers } from './host-groups-core'

export async function createGroup(
  scopeId: string,
  input: unknown,
): Promise<{ success: true; group: import('@/lib/db/schema').HostGroup } | { error: string }> {
  return createGroupCore(scopeId, input)
}

export async function updateGroup(
  scopeId: string,
  groupId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  return updateGroupCore(scopeId, groupId, input)
}

export async function deleteGroup(
  scopeId: string,
  groupId: string,
): Promise<{ success: true } | { error: string }> {
  return deleteGroupCore(scopeId, groupId)
}

export async function listGroups(
  ...args: [] | [string]
): Promise<HostGroupWithCount[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveCurrentActionScope(session)
  return listGroupsCore(currentScope)
}

export async function getGroup(
  scopeId: string,
  groupId: string,
): Promise<HostGroupWithMembers | null> {
  return getGroupCore(scopeId, groupId)
}

export async function addHostToGroup(
  ...args: [string, string] | [string, string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, groupId, hostId] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return addHostToGroupCore(currentScope, groupId, hostId)
}

export async function removeHostFromGroup(
  ...args: [string, string] | [string, string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, groupId, hostId] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return removeHostFromGroupCore(currentScope, groupId, hostId)
}

export async function listHostsInGroup(
  scopeId: string,
  groupId: string,
): Promise<import('@/lib/db/schema').Host[]> {
  return listHostsInGroupCore(scopeId, groupId)
}

export async function listGroupsForHost(
  ...args: [string] | [string, string]
): Promise<import('@/lib/db/schema').HostGroup[]> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listGroupsForHostCore(currentScope, hostId)
}
