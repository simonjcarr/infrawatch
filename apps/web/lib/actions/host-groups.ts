'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope, resolveOptionalActionScope } from './action-scope'
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
  ...args: [unknown] | [string, unknown]
): Promise<{ success: true; group: import('@/lib/db/schema').HostGroup } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, input] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return createGroupCore(currentScope, input)
}

export async function updateGroup(
  ...args: [string, unknown] | [string, string, unknown]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, groupId, input] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  return updateGroupCore(currentScope, groupId, input)
}

export async function deleteGroup(
  ...args: [string] | [string, string]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, groupId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return deleteGroupCore(currentScope, groupId)
}

export async function listGroups(
  ...args: [] | [string]
): Promise<HostGroupWithCount[]> {
  const session = await getRequiredSession()
  const currentScope = args[0] ?? resolveOptionalActionScope(session)
  if (!currentScope) return []
  return listGroupsCore(currentScope)
}

export async function getGroup(
  ...args: [string] | [string, string]
): Promise<HostGroupWithMembers | null> {
  const session = await getRequiredSession()
  const [currentScope, groupId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return getGroupCore(currentScope, groupId)
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
  ...args: [string] | [string, string]
): Promise<import('@/lib/db/schema').Host[]> {
  const session = await getRequiredSession()
  const [currentScope, groupId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listHostsInGroupCore(currentScope, groupId)
}

export async function listGroupsForHost(
  ...args: [string] | [string, string]
): Promise<import('@/lib/db/schema').HostGroup[]> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  return listGroupsForHostCore(currentScope, hostId)
}
