'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { domainAccounts } from '@/lib/db/schema'
import { eq, and, isNull, asc, desc, sql } from 'drizzle-orm'
import type { DomainAccount, DomainAccountSource, DomainAccountStatus } from '@/lib/db/schema'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DomainAccountListFilters = {
  source?: DomainAccountSource
  status?: DomainAccountStatus
  search?: string
  sortBy?: 'username' | 'display_name' | 'last_synced'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export type DomainAccountCounts = {
  total: number
  ldap: number
  activeDirectory: number
  manual: number
  active: number
  disabled: number
  locked: number
  expired: number
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createDomainAccountSchema = z.object({
  username: z.string().min(1, 'Username is required').max(255),
  displayName: z.string().max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
  source: z.enum(['ldap', 'active_directory', 'manual']).default('manual'),
  distinguishedName: z.string().max(1000).optional(),
  samAccountName: z.string().max(255).optional(),
  userPrincipalName: z.string().max(255).optional(),
  groups: z.array(z.string()).optional(),
})

const updateDomainAccountSchema = z.object({
  displayName: z.string().max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
  status: z.enum(['active', 'disabled', 'locked', 'expired']).optional(),
  groups: z.array(z.string()).optional(),
})

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getDomainAccounts(
  orgId: string,
  filters: DomainAccountListFilters = {},
): Promise<DomainAccount[]> {
  const {
    source,
    status,
    search,
    sortBy = 'username',
    sortDir = 'asc',
    limit = 100,
    offset = 0,
  } = filters

  const conditions = [
    eq(domainAccounts.organisationId, orgId),
    isNull(domainAccounts.deletedAt),
    ...(source != null ? [eq(domainAccounts.source, source)] : []),
    ...(status != null ? [eq(domainAccounts.status, status)] : []),
    ...(search != null && search !== ''
      ? [sql`(${domainAccounts.username} ILIKE ${'%' + search + '%'} OR ${domainAccounts.displayName} ILIKE ${'%' + search + '%'})`]
      : []),
  ]

  const orderCol =
    sortBy === 'display_name'
      ? domainAccounts.displayName
      : sortBy === 'last_synced'
        ? domainAccounts.lastSyncedAt
        : domainAccounts.username

  const order = sortDir === 'desc' ? desc(orderCol) : asc(orderCol)

  return db.query.domainAccounts.findMany({
    where: and(...conditions),
    orderBy: order,
    limit,
    offset,
  })
}

export async function getDomainAccount(
  orgId: string,
  accountId: string,
): Promise<DomainAccount | null> {
  const result = await db.query.domainAccounts.findFirst({
    where: and(
      eq(domainAccounts.id, accountId),
      eq(domainAccounts.organisationId, orgId),
      isNull(domainAccounts.deletedAt),
    ),
  })
  return result ?? null
}

export async function getDomainAccountCounts(
  orgId: string,
): Promise<DomainAccountCounts> {
  const [sourceRows, statusRows] = await Promise.all([
    db
      .select({
        source: domainAccounts.source,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(domainAccounts)
      .where(and(eq(domainAccounts.organisationId, orgId), isNull(domainAccounts.deletedAt)))
      .groupBy(domainAccounts.source),
    db
      .select({
        status: domainAccounts.status,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(domainAccounts)
      .where(and(eq(domainAccounts.organisationId, orgId), isNull(domainAccounts.deletedAt)))
      .groupBy(domainAccounts.status),
  ])

  const counts: DomainAccountCounts = {
    total: 0,
    ldap: 0,
    activeDirectory: 0,
    manual: 0,
    active: 0,
    disabled: 0,
    locked: 0,
    expired: 0,
  }

  for (const row of sourceRows) {
    counts.total += row.count
    if (row.source === 'ldap') counts.ldap = row.count
    else if (row.source === 'active_directory') counts.activeDirectory = row.count
    else if (row.source === 'manual') counts.manual = row.count
  }

  for (const row of statusRows) {
    if (row.status === 'active') counts.active = row.count
    else if (row.status === 'disabled') counts.disabled = row.count
    else if (row.status === 'locked') counts.locked = row.count
    else if (row.status === 'expired') counts.expired = row.count
  }

  return counts
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createDomainAccount(
  orgId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const parsed = createDomainAccountSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    const [row] = await db
      .insert(domainAccounts)
      .values({
        organisationId: orgId,
        username: parsed.data.username,
        displayName: parsed.data.displayName || null,
        email: parsed.data.email || null,
        source: parsed.data.source,
        distinguishedName: parsed.data.distinguishedName || null,
        samAccountName: parsed.data.samAccountName || null,
        userPrincipalName: parsed.data.userPrincipalName || null,
        groups: parsed.data.groups ?? null,
      })
      .returning({ id: domainAccounts.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('domain_accounts_org_source_username_idx')) {
      return { error: 'An account with this username and source already exists' }
    }
    console.error('Failed to create domain account:', err)
    return { error: 'Failed to create domain account' }
  }
}

export async function updateDomainAccount(
  orgId: string,
  accountId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateDomainAccountSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const existing = await db.query.domainAccounts.findFirst({
    where: and(
      eq(domainAccounts.id, accountId),
      eq(domainAccounts.organisationId, orgId),
      isNull(domainAccounts.deletedAt),
    ),
  })
  if (!existing) return { error: 'Account not found' }

  await db
    .update(domainAccounts)
    .set({
      ...(parsed.data.displayName !== undefined && { displayName: parsed.data.displayName || null }),
      ...(parsed.data.email !== undefined && { email: parsed.data.email || null }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.groups !== undefined && { groups: parsed.data.groups }),
      updatedAt: new Date(),
    })
    .where(and(eq(domainAccounts.id, accountId), eq(domainAccounts.organisationId, orgId)))

  return { success: true }
}

export async function deleteDomainAccount(
  orgId: string,
  accountId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.domainAccounts.findFirst({
    where: and(
      eq(domainAccounts.id, accountId),
      eq(domainAccounts.organisationId, orgId),
      isNull(domainAccounts.deletedAt),
    ),
  })
  if (!existing) return { error: 'Account not found' }

  await db
    .update(domainAccounts)
    .set({ deletedAt: new Date() })
    .where(and(eq(domainAccounts.id, accountId), eq(domainAccounts.organisationId, orgId)))

  return { success: true }
}
