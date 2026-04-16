'use server'

import { db } from '@/lib/db'
import { networks, hostNetworkMemberships, hosts } from '@/lib/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getRequiredSession } from '@/lib/auth/session'
import type { Network, Host } from '@/lib/db/schema'

export type NetworkWithCount = Network & { hostCount: number }
export type NetworkWithMembership = Network & { autoAssigned: boolean }

const ADMIN_ROLES = ['org_admin', 'super_admin']
const MEMBERSHIP_ROLES = ['org_admin', 'super_admin', 'engineer']

const networkSchema = z.object({
  name: z.string().min(1).max(100),
  cidr: z
    .string()
    .regex(
      /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
      'Must be a valid CIDR (e.g. 192.168.1.0/24)',
    ),
  description: z.string().max(500).optional(),
})

// ── Network CRUD ──────────────────────────────────────────────────────────────

export async function listNetworks(orgId: string): Promise<NetworkWithCount[]> {
  const rows = await db.query.networks.findMany({
    where: and(eq(networks.organisationId, orgId), isNull(networks.deletedAt)),
    orderBy: (n, { asc }) => [asc(n.name)],
  })

  const counts = await db
    .select({
      networkId: hostNetworkMemberships.networkId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(hostNetworkMemberships)
    .where(and(eq(hostNetworkMemberships.organisationId, orgId), isNull(hostNetworkMemberships.deletedAt)))
    .groupBy(hostNetworkMemberships.networkId)

  const countMap = new Map(counts.map((c) => [c.networkId, c.count]))

  return rows.map((n) => ({ ...n, hostCount: countMap.get(n.id) ?? 0 }))
}

export async function getNetwork(
  orgId: string,
  networkId: string,
): Promise<(Network & { members: Host[] }) | null> {
  const network = await db.query.networks.findFirst({
    where: and(eq(networks.id, networkId), eq(networks.organisationId, orgId), isNull(networks.deletedAt)),
  })
  if (!network) return null

  const members = await listHostsInNetwork(orgId, networkId)
  return { ...network, members }
}

export async function createNetwork(
  orgId: string,
  data: { name: string; cidr: string; description?: string },
): Promise<{ success: true; network: Network } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = networkSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  try {
    const rows = await db
      .insert(networks)
      .values({
        organisationId: orgId,
        name: parsed.data.name,
        cidr: parsed.data.cidr,
        description: parsed.data.description ?? null,
      })
      .returning()
    const network = rows[0]
    if (!network) return { error: 'Failed to create network' }
    return { success: true, network }
  } catch (err) {
    console.error('Failed to create network:', err)
    return { error: 'Failed to create network' }
  }
}

export async function updateNetwork(
  orgId: string,
  networkId: string,
  data: { name: string; cidr: string; description?: string },
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = networkSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  try {
    const result = await db
      .update(networks)
      .set({
        name: parsed.data.name,
        cidr: parsed.data.cidr,
        description: parsed.data.description ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(networks.id, networkId), eq(networks.organisationId, orgId), isNull(networks.deletedAt)))
      .returning({ id: networks.id })

    if (result.length === 0) return { error: 'Network not found' }
    return { success: true }
  } catch (err) {
    console.error('Failed to update network:', err)
    return { error: 'Failed to update network' }
  }
}

export async function deleteNetwork(
  orgId: string,
  networkId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const result = await db
      .update(networks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(networks.id, networkId), eq(networks.organisationId, orgId), isNull(networks.deletedAt)))
      .returning({ id: networks.id })

    if (result.length === 0) return { error: 'Network not found' }

    // Soft-delete all memberships for this network
    await db
      .update(hostNetworkMemberships)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(hostNetworkMemberships.networkId, networkId),
          eq(hostNetworkMemberships.organisationId, orgId),
          isNull(hostNetworkMemberships.deletedAt),
        ),
      )

    return { success: true }
  } catch (err) {
    console.error('Failed to delete network:', err)
    return { error: 'Failed to delete network' }
  }
}

// ── Membership ────────────────────────────────────────────────────────────────

export async function addHostToNetwork(
  orgId: string,
  networkId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!MEMBERSHIP_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const existing = await db.query.hostNetworkMemberships.findFirst({
      where: and(
        eq(hostNetworkMemberships.networkId, networkId),
        eq(hostNetworkMemberships.hostId, hostId),
        eq(hostNetworkMemberships.organisationId, orgId),
      ),
    })

    if (existing) {
      if (!existing.deletedAt) return { error: 'Host is already in this network' }
      // Restore soft-deleted membership
      await db
        .update(hostNetworkMemberships)
        .set({ deletedAt: null, autoAssigned: false, updatedAt: new Date() })
        .where(eq(hostNetworkMemberships.id, existing.id))
      return { success: true }
    }

    await db.insert(hostNetworkMemberships).values({
      organisationId: orgId,
      networkId,
      hostId,
      autoAssigned: false,
    })
    return { success: true }
  } catch (err) {
    console.error('Failed to add host to network:', err)
    return { error: 'Failed to add host to network' }
  }
}

export async function removeHostFromNetwork(
  orgId: string,
  networkId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!MEMBERSHIP_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const result = await db
      .update(hostNetworkMemberships)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(hostNetworkMemberships.networkId, networkId),
          eq(hostNetworkMemberships.hostId, hostId),
          eq(hostNetworkMemberships.organisationId, orgId),
          isNull(hostNetworkMemberships.deletedAt),
        ),
      )
      .returning({ id: hostNetworkMemberships.id })

    if (result.length === 0) return { error: 'Membership not found' }
    return { success: true }
  } catch (err) {
    console.error('Failed to remove host from network:', err)
    return { error: 'Failed to remove host from network' }
  }
}

export async function listHostsInNetwork(orgId: string, networkId: string): Promise<Host[]> {
  const members = await db.query.hostNetworkMemberships.findMany({
    where: and(
      eq(hostNetworkMemberships.networkId, networkId),
      eq(hostNetworkMemberships.organisationId, orgId),
      isNull(hostNetworkMemberships.deletedAt),
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

export type NetworkMembershipEntry = {
  hostId: string
  autoAssigned: boolean
}

export async function listMembershipsForNetwork(
  orgId: string,
  networkId: string,
): Promise<NetworkMembershipEntry[]> {
  const rows = await db.query.hostNetworkMemberships.findMany({
    where: and(
      eq(hostNetworkMemberships.networkId, networkId),
      eq(hostNetworkMemberships.organisationId, orgId),
      isNull(hostNetworkMemberships.deletedAt),
    ),
    columns: { hostId: true, autoAssigned: true },
  })
  return rows
}

export async function listNetworksForHost(orgId: string, hostId: string): Promise<NetworkWithMembership[]> {
  const members = await db.query.hostNetworkMemberships.findMany({
    where: and(
      eq(hostNetworkMemberships.hostId, hostId),
      eq(hostNetworkMemberships.organisationId, orgId),
      isNull(hostNetworkMemberships.deletedAt),
    ),
    columns: { networkId: true, autoAssigned: true },
  })

  if (members.length === 0) return []

  const networkIds = members.map((m) => m.networkId)
  const autoMap = new Map(members.map((m) => [m.networkId, m.autoAssigned]))

  const networkRows = await db.query.networks.findMany({
    where: and(eq(networks.organisationId, orgId), isNull(networks.deletedAt)),
  })

  return networkRows
    .filter((n) => networkIds.includes(n.id))
    .map((n) => ({ ...n, autoAssigned: autoMap.get(n.id) ?? false }))
}
