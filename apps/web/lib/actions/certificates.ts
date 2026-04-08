'use server'

import { db } from '@/lib/db'
import { certificates, certificateEvents } from '@/lib/db/schema'
import { eq, and, isNull, asc, desc, sql } from 'drizzle-orm'
import type { Certificate, CertificateEvent, CertificateStatus } from '@/lib/db/schema'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CertificateListFilters = {
  status?: CertificateStatus
  host?: string
  sortBy?: 'not_after' | 'common_name' | 'last_seen'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export type CertificateCounts = {
  valid: number
  expiringSoon: number
  expired: number
  invalid: number
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getCertificates(
  orgId: string,
  filters: CertificateListFilters = {},
): Promise<Certificate[]> {
  const {
    status,
    host,
    sortBy = 'not_after',
    sortDir = 'asc',
    limit = 50,
    offset = 0,
  } = filters

  const conditions = [
    eq(certificates.organisationId, orgId),
    isNull(certificates.deletedAt),
    ...(status != null ? [eq(certificates.status, status)] : []),
    ...(host != null && host !== '' ? [sql`${certificates.host} ILIKE ${'%' + host + '%'}`] : []),
  ]

  const orderCol =
    sortBy === 'common_name'
      ? certificates.commonName
      : sortBy === 'last_seen'
        ? certificates.lastSeenAt
        : certificates.notAfter

  const order = sortDir === 'desc' ? desc(orderCol) : asc(orderCol)

  return db.query.certificates.findMany({
    where: and(...conditions),
    orderBy: order,
    limit,
    offset,
  })
}

export async function getCertificate(
  orgId: string,
  certId: string,
): Promise<{ certificate: Certificate; events: CertificateEvent[] } | null> {
  const certificate = await db.query.certificates.findFirst({
    where: and(
      eq(certificates.id, certId),
      eq(certificates.organisationId, orgId),
      isNull(certificates.deletedAt),
    ),
  })
  if (!certificate) return null

  const events = await db.query.certificateEvents.findMany({
    where: and(
      eq(certificateEvents.certificateId, certId),
      eq(certificateEvents.organisationId, orgId),
    ),
    orderBy: desc(certificateEvents.occurredAt),
  })

  return { certificate, events }
}

export async function getCertificateCounts(orgId: string): Promise<CertificateCounts> {
  const rows = await db
    .select({
      status: certificates.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(certificates)
    .where(and(eq(certificates.organisationId, orgId), isNull(certificates.deletedAt)))
    .groupBy(certificates.status)

  const counts: CertificateCounts = { valid: 0, expiringSoon: 0, expired: 0, invalid: 0 }
  for (const row of rows) {
    const status = row.status as CertificateStatus
    if (status === 'valid') counts.valid = row.count
    else if (status === 'expiring_soon') counts.expiringSoon = row.count
    else if (status === 'expired') counts.expired = row.count
    else if (status === 'invalid') counts.invalid = row.count
  }
  return counts
}

export async function deleteCertificate(
  orgId: string,
  certId: string,
): Promise<{ success: true } | { error: string }> {
  const existing = await db.query.certificates.findFirst({
    where: and(
      eq(certificates.id, certId),
      eq(certificates.organisationId, orgId),
      isNull(certificates.deletedAt),
    ),
  })
  if (!existing) return { error: 'Certificate not found' }

  await db
    .update(certificates)
    .set({ deletedAt: new Date() })
    .where(and(eq(certificates.id, certId), eq(certificates.organisationId, orgId)))

  return { success: true }
}
