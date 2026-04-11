'use server'

import { db } from '@/lib/db'
import { hostGroups, hostGroupMembers, hosts } from '@/lib/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { HostGroup, HostGroupMember } from '@/lib/db/schema'
import type { Host } from '@/lib/db/schema'

export type HostGroupWithCount = HostGroup & { hostCount: number }
export type HostGroupWithMembers = HostGroup & { members: Host[] }

// ── Group CRUD ─────────────────────────────────────────────────────────────

export async function createGroup(
  orgId: string,
  data: { name: string; description?: string },
): Promise<{ success: true; group: HostGroup } | { error: string }> {
  try {
    const rows = await db
      .insert(hostGroups)
      .values({
        organisationId: orgId,
        name: data.name,
        description: data.description ?? null,
      })
      .returning()
    const group = rows[0]
    if (!group) return { error: 'Failed to create group' }
    return { success: true, group }
  } catch (err) {
    console.error('Failed to create group:', err)
    return { error: 'Failed to create group' }
  }
}

export async function updateGroup(
  orgId: string,
  groupId: string,
  data: { name: string; description?: string },
): Promise<{ success: true } | { error: string }> {
  try {
    const result = await db
      .update(hostGroups)
      .set({ name: data.name, description: data.description ?? null, updatedAt: new Date() })
      .where(and(eq(hostGroups.id, groupId), eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)))
      .returning({ id: hostGroups.id })

    if (result.length === 0) return { error: 'Group not found' }
    return { success: true }
  } catch (err) {
    console.error('Failed to update group:', err)
    return { error: 'Failed to update group' }
  }
}

export async function deleteGroup(
  orgId: string,
  groupId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    // Soft-delete the group
    const result = await db
      .update(hostGroups)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(hostGroups.id, groupId), eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)))
      .returning({ id: hostGroups.id })

    if (result.length === 0) return { error: 'Group not found' }

    // Soft-delete all memberships for this group
    await db
      .update(hostGroupMembers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(hostGroupMembers.groupId, groupId), eq(hostGroupMembers.organisationId, orgId), isNull(hostGroupMembers.deletedAt)))

    return { success: true }
  } catch (err) {
    console.error('Failed to delete group:', err)
    return { error: 'Failed to delete group' }
  }
}

export async function listGroups(orgId: string): Promise<HostGroupWithCount[]> {
  const groups = await db.query.hostGroups.findMany({
    where: and(eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
    orderBy: (g, { asc }) => [asc(g.name)],
  })

  // Get host counts for each group in one query
  const counts = await db
    .select({
      groupId: hostGroupMembers.groupId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(hostGroupMembers)
    .where(and(eq(hostGroupMembers.organisationId, orgId), isNull(hostGroupMembers.deletedAt)))
    .groupBy(hostGroupMembers.groupId)

  const countMap = new Map(counts.map((c) => [c.groupId, c.count]))

  return groups.map((g) => ({ ...g, hostCount: countMap.get(g.id) ?? 0 }))
}

export async function getGroup(orgId: string, groupId: string): Promise<HostGroupWithMembers | null> {
  const group = await db.query.hostGroups.findFirst({
    where: and(eq(hostGroups.id, groupId), eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
  })
  if (!group) return null

  const members = await listHostsInGroup(orgId, groupId)
  return { ...group, members }
}

// ── Membership ────────────────────────────────────────────────────────────

export async function addHostToGroup(
  orgId: string,
  groupId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    // Check if already a member (including soft-deleted — restore if so)
    const existing = await db.query.hostGroupMembers.findFirst({
      where: and(
        eq(hostGroupMembers.groupId, groupId),
        eq(hostGroupMembers.hostId, hostId),
        eq(hostGroupMembers.organisationId, orgId),
      ),
    })

    if (existing) {
      if (!existing.deletedAt) return { error: 'Host is already in this group' }
      // Restore soft-deleted membership
      await db
        .update(hostGroupMembers)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(hostGroupMembers.id, existing.id))
      return { success: true }
    }

    await db.insert(hostGroupMembers).values({
      organisationId: orgId,
      groupId,
      hostId,
    })
    return { success: true }
  } catch (err) {
    console.error('Failed to add host to group:', err)
    return { error: 'Failed to add host to group' }
  }
}

export async function removeHostFromGroup(
  orgId: string,
  groupId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const result = await db
      .update(hostGroupMembers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(hostGroupMembers.groupId, groupId),
          eq(hostGroupMembers.hostId, hostId),
          eq(hostGroupMembers.organisationId, orgId),
          isNull(hostGroupMembers.deletedAt),
        ),
      )
      .returning({ id: hostGroupMembers.id })

    if (result.length === 0) return { error: 'Membership not found' }
    return { success: true }
  } catch (err) {
    console.error('Failed to remove host from group:', err)
    return { error: 'Failed to remove host from group' }
  }
}

export async function listHostsInGroup(orgId: string, groupId: string): Promise<Host[]> {
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.groupId, groupId),
      eq(hostGroupMembers.organisationId, orgId),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { hostId: true },
  })

  if (members.length === 0) return []

  const hostIds = members.map((m) => m.hostId)

  const hostRows = await db.query.hosts.findMany({
    where: and(eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
  })

  return hostRows.filter((h) => hostIds.includes(h.id))
}

export async function listGroupsForHost(orgId: string, hostId: string): Promise<HostGroup[]> {
  const members = await db.query.hostGroupMembers.findMany({
    where: and(
      eq(hostGroupMembers.hostId, hostId),
      eq(hostGroupMembers.organisationId, orgId),
      isNull(hostGroupMembers.deletedAt),
    ),
    columns: { groupId: true },
  })

  if (members.length === 0) return []

  const groupIds = members.map((m) => m.groupId)

  const groupRows = await db.query.hostGroups.findMany({
    where: and(eq(hostGroups.organisationId, orgId), isNull(hostGroups.deletedAt)),
  })

  return groupRows.filter((g) => groupIds.includes(g.id))
}
