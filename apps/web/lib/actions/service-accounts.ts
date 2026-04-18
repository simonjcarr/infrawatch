'use server'

import { db } from '@/lib/db'
import { serviceAccounts, sshKeys, identityEvents, hosts } from '@/lib/db/schema'
import { eq, and, isNull, asc, desc, sql } from 'drizzle-orm'
import type {
  ServiceAccount,
  SshKey,
  IdentityEvent,
  ServiceAccountStatus,
  ServiceAccountType,
} from '@/lib/db/schema'
import type { Host } from '@/lib/db/schema'
import { requireFeature } from '@/lib/actions/licence-guard'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceAccountListFilters = {
  accountType?: ServiceAccountType
  status?: ServiceAccountStatus
  hostId?: string
  search?: string
  sortBy?: 'username' | 'last_seen' | 'uid'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export type ServiceAccountCounts = {
  total: number
  human: number
  service: number
  system: number
  disabled: number
  missing: number
}

export type ServiceAccountWithHost = ServiceAccount & {
  hostHostname?: string
  sshKeyCount?: number
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getServiceAccounts(
  orgId: string,
  filters: ServiceAccountListFilters = {},
): Promise<ServiceAccountWithHost[]> {
  await requireFeature(orgId, 'serviceAccountTracker')
  const {
    accountType,
    status,
    hostId,
    search,
    sortBy = 'username',
    sortDir = 'asc',
    limit = 100,
    offset = 0,
  } = filters

  const conditions = [
    eq(serviceAccounts.organisationId, orgId),
    isNull(serviceAccounts.deletedAt),
    ...(accountType != null ? [eq(serviceAccounts.accountType, accountType)] : []),
    ...(status != null ? [eq(serviceAccounts.status, status)] : []),
    ...(hostId != null && hostId !== '' ? [eq(serviceAccounts.hostId, hostId)] : []),
    ...(search != null && search !== ''
      ? [sql`${serviceAccounts.username} ILIKE ${'%' + search + '%'}`]
      : []),
  ]

  const orderCol =
    sortBy === 'last_seen'
      ? serviceAccounts.lastSeenAt
      : sortBy === 'uid'
        ? serviceAccounts.uid
        : serviceAccounts.username

  const order = sortDir === 'desc' ? desc(orderCol) : asc(orderCol)

  const accounts = await db.query.serviceAccounts.findMany({
    where: and(...conditions),
    orderBy: order,
    limit,
    offset,
  })

  // Enrich with host hostname and SSH key counts
  if (accounts.length === 0) return []

  const hostIds = [...new Set(accounts.map((a) => a.hostId))]
  const accountIds = accounts.map((a) => a.id)

  const hostRows = await db.query.hosts.findMany({
    where: and(
      sql`${hosts.id} IN (${sql.join(hostIds.map((id) => sql`${id}`), sql`, `)})`,
      eq(hosts.organisationId, orgId),
    ),
    columns: { id: true, hostname: true },
  })
  const hostMap = new Map(hostRows.map((h) => [h.id, h.hostname]))

  // Count SSH keys per account
  const keyCountRows = await db
    .select({
      serviceAccountId: sshKeys.serviceAccountId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(sshKeys)
    .where(
      and(
        sql`${sshKeys.serviceAccountId} IN (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})`,
        isNull(sshKeys.deletedAt),
        eq(sshKeys.status, 'active'),
      ),
    )
    .groupBy(sshKeys.serviceAccountId)

  const keyCountMap = new Map(keyCountRows.map((r) => [r.serviceAccountId, r.count]))

  return accounts.map((a) => ({
    ...a,
    hostHostname: hostMap.get(a.hostId),
    sshKeyCount: keyCountMap.get(a.id) ?? 0,
  }))
}

export async function getServiceAccount(
  orgId: string,
  accountId: string,
): Promise<{
  account: ServiceAccount
  keys: SshKey[]
  events: IdentityEvent[]
  host: Host | null
} | null> {
  await requireFeature(orgId, 'serviceAccountTracker')
  const account = await db.query.serviceAccounts.findFirst({
    where: and(
      eq(serviceAccounts.id, accountId),
      eq(serviceAccounts.organisationId, orgId),
      isNull(serviceAccounts.deletedAt),
    ),
  })
  if (!account) return null

  const [keys, events, host] = await Promise.all([
    db.query.sshKeys.findMany({
      where: and(
        eq(sshKeys.serviceAccountId, accountId),
        isNull(sshKeys.deletedAt),
      ),
      orderBy: desc(sshKeys.lastSeenAt),
    }),
    db.query.identityEvents.findMany({
      where: and(
        eq(identityEvents.serviceAccountId, accountId),
        eq(identityEvents.organisationId, orgId),
      ),
      orderBy: desc(identityEvents.occurredAt),
      limit: 50,
    }),
    db.query.hosts.findFirst({
      where: and(
        eq(hosts.id, account.hostId),
        eq(hosts.organisationId, orgId),
      ),
    }),
  ])

  return { account, keys, events, host: host ?? null }
}

export async function getServiceAccountCounts(
  orgId: string,
): Promise<ServiceAccountCounts> {
  await requireFeature(orgId, 'serviceAccountTracker')
  const [typeRows, statusRows] = await Promise.all([
    db
      .select({
        accountType: serviceAccounts.accountType,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(serviceAccounts)
      .where(and(eq(serviceAccounts.organisationId, orgId), isNull(serviceAccounts.deletedAt)))
      .groupBy(serviceAccounts.accountType),
    db
      .select({
        status: serviceAccounts.status,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(serviceAccounts)
      .where(and(eq(serviceAccounts.organisationId, orgId), isNull(serviceAccounts.deletedAt)))
      .groupBy(serviceAccounts.status),
  ])

  const counts: ServiceAccountCounts = {
    total: 0,
    human: 0,
    service: 0,
    system: 0,
    disabled: 0,
    missing: 0,
  }

  for (const row of typeRows) {
    counts.total += row.count
    if (row.accountType === 'human') counts.human = row.count
    else if (row.accountType === 'service') counts.service = row.count
    else if (row.accountType === 'system') counts.system = row.count
  }

  for (const row of statusRows) {
    if (row.status === 'disabled') counts.disabled = row.count
    else if (row.status === 'missing') counts.missing = row.count
  }

  return counts
}

export async function getSshKeysByFingerprint(
  orgId: string,
  fingerprint: string,
): Promise<(SshKey & { hostHostname?: string })[]> {
  await requireFeature(orgId, 'sshKeyInventory')
  const keys = await db.query.sshKeys.findMany({
    where: and(
      eq(sshKeys.organisationId, orgId),
      eq(sshKeys.fingerprintSha256, fingerprint),
      isNull(sshKeys.deletedAt),
    ),
    orderBy: desc(sshKeys.lastSeenAt),
  })

  if (keys.length === 0) return []

  const hostIds = [...new Set(keys.map((k) => k.hostId))]
  const hostRows = await db.query.hosts.findMany({
    where: and(
      sql`${hosts.id} IN (${sql.join(hostIds.map((id) => sql`${id}`), sql`, `)})`,
      eq(hosts.organisationId, orgId),
    ),
    columns: { id: true, hostname: true },
  })
  const hostMap = new Map(hostRows.map((h) => [h.id, h.hostname]))

  return keys.map((k) => ({
    ...k,
    hostHostname: hostMap.get(k.hostId),
  }))
}
