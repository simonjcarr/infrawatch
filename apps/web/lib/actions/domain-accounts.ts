'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { domainAccounts, ldapConfigurations } from '@/lib/db/schema'
import { eq, and, isNull, asc, desc, sql } from 'drizzle-orm'
import type { DomainAccount, DomainAccountStatus } from '@/lib/db/schema'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DomainAccountListFilters = {
  status?: DomainAccountStatus
  search?: string
  sortBy?: 'username' | 'display_name' | 'status'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export type DomainAccountCounts = {
  total: number
  active: number
  disabled: number
  locked: number
  expired: number
}

export type LdapConfigOption = {
  id: string
  name: string
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createDomainAccountSchema = z.object({
  username: z.string().min(1, 'Username is required').max(255),
  displayName: z.string().max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
  ldapConfigurationId: z.string().nullable().optional(),
  passwordExpiresAt: z.string().nullable().optional(),
  distinguishedName: z.string().max(1000).optional(),
  samAccountName: z.string().max(255).optional(),
  userPrincipalName: z.string().max(255).optional(),
  groups: z.array(z.string()).optional(),
  accountLocked: z.boolean().optional(),
  passwordLastChangedAt: z.string().nullable().optional(),
})

const updateDomainAccountSchema = z.object({
  displayName: z.string().max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
  status: z.enum(['active', 'disabled', 'locked', 'expired']).optional(),
  groups: z.array(z.string()).optional(),
  ldapConfigurationId: z.string().nullable().optional(),
  passwordExpiresAt: z.string().nullable().optional(),
})

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getDomainAccounts(
  orgId: string,
  filters: DomainAccountListFilters = {},
): Promise<DomainAccount[]> {
  const {
    status,
    search,
    sortBy = 'username',
    sortDir = 'asc',
    limit = 100,
    offset = 0,
  } = filters

  const conditions = [
    eq(domainAccounts.organisationId, orgId),
    ...(status != null ? [eq(domainAccounts.status, status)] : []),
    ...(search != null && search !== ''
      ? [sql`(${domainAccounts.username} ILIKE ${'%' + search + '%'} OR ${domainAccounts.displayName} ILIKE ${'%' + search + '%'})`]
      : []),
  ]

  const orderCol =
    sortBy === 'display_name'
      ? domainAccounts.displayName
      : sortBy === 'status'
        ? domainAccounts.status
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
    ),
  })
  return result ?? null
}

export async function getDomainAccountCounts(
  orgId: string,
): Promise<DomainAccountCounts> {
  const statusRows = await db
    .select({
      status: domainAccounts.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(domainAccounts)
    .where(eq(domainAccounts.organisationId, orgId))
    .groupBy(domainAccounts.status)

  const counts: DomainAccountCounts = {
    total: 0,
    active: 0,
    disabled: 0,
    locked: 0,
    expired: 0,
  }

  for (const row of statusRows) {
    counts.total += row.count
    if (row.status === 'active') counts.active = row.count
    else if (row.status === 'disabled') counts.disabled = row.count
    else if (row.status === 'locked') counts.locked = row.count
    else if (row.status === 'expired') counts.expired = row.count
  }

  return counts
}

export async function getLdapConfigOptions(
  orgId: string,
): Promise<LdapConfigOption[]> {
  const rows = await db.query.ldapConfigurations.findMany({
    where: and(
      eq(ldapConfigurations.organisationId, orgId),
      eq(ldapConfigurations.enabled, true),
      isNull(ldapConfigurations.deletedAt),
    ),
    columns: { id: true, name: true },
    orderBy: ldapConfigurations.name,
  })
  return rows
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
        source: 'manual',
        ldapConfigurationId: parsed.data.ldapConfigurationId || null,
        distinguishedName: parsed.data.distinguishedName || null,
        samAccountName: parsed.data.samAccountName || null,
        userPrincipalName: parsed.data.userPrincipalName || null,
        groups: parsed.data.groups ?? null,
        accountLocked: parsed.data.accountLocked ?? false,
        passwordExpiresAt: parsed.data.passwordExpiresAt
          ? new Date(parsed.data.passwordExpiresAt)
          : null,
        passwordLastChangedAt: parsed.data.passwordLastChangedAt
          ? new Date(parsed.data.passwordLastChangedAt)
          : null,
      })
      .returning({ id: domainAccounts.id })

    if (!row) return { error: 'Insert failed' }
    return { success: true, id: row.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('domain_accounts_org_source_username_idx')) {
      return { error: 'An account with this username already exists' }
    }
    console.error('Failed to create service account:', err)
    return { error: 'Failed to create service account' }
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
      ...(parsed.data.ldapConfigurationId !== undefined && { ldapConfigurationId: parsed.data.ldapConfigurationId || null }),
      ...(parsed.data.passwordExpiresAt !== undefined && {
        passwordExpiresAt: parsed.data.passwordExpiresAt
          ? new Date(parsed.data.passwordExpiresAt)
          : null,
      }),
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
    ),
  })
  if (!existing) return { error: 'Account not found' }

  await db
    .delete(domainAccounts)
    .where(and(eq(domainAccounts.id, accountId), eq(domainAccounts.organisationId, orgId)))

  return { success: true }
}
