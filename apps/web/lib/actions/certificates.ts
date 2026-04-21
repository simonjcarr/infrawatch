'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { certificates, certificateEvents } from '@/lib/db/schema'
import { eq, and, isNull, asc, desc, sql } from 'drizzle-orm'
import type { Certificate, CertificateEvent, CertificateStatus, CertificateDetails } from '@/lib/db/schema'
import { getRequiredSession } from '@/lib/auth/session'
import { requireFeature } from '@/lib/actions/licence-guard'
import { escapeLikePattern } from '@/lib/utils'
import { computeExpiryStatus } from '@/lib/certificates/expiry'
import {
  fetchCertificateFromUrl,
  parseCertificateBuffer,
  resolveUrlTarget,
  type ParsedCertificate,
} from '@/lib/certificates/fetch'
import { assertPublicHost } from '@/lib/net/ssrf-guard'
import { createRateLimiter } from '@/lib/rate-limit'

const trackFromUrlLimiter = createRateLimiter(60_000, 20)

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
  await requireFeature(orgId, 'certExpiryTracker')
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
    ...(host != null && host !== ''
      ? [sql`${certificates.host} ILIKE ${`%${escapeLikePattern(host)}%`}`]
      : []),
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
  await requireFeature(orgId, 'certExpiryTracker')
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
  await requireFeature(orgId, 'certExpiryTracker')
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
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) {
    return { error: 'Organisation mismatch' }
  }
  if (session.user.role === 'read_only') {
    return { error: 'Insufficient permissions to delete certificates' }
  }

  await requireFeature(orgId, 'certExpiryTracker')
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

// ─── Track a certificate from the Certificate Checker ─────────────────────────

const REFRESH_INTERVAL_OPTIONS = [900, 3600, 21600, 86400] as const

const trackFromUrlSchema = z.object({
  url: z.string().min(1).max(512),
  refreshIntervalSeconds: z.number().int().refine(
    (v) => (REFRESH_INTERVAL_OPTIONS as readonly number[]).includes(v),
    { message: 'Refresh interval must be 15m, 1h, 6h, or 24h' },
  ).optional(),
})

// 64 KB is well beyond any real certificate chain; rejects degenerate payloads.
const MAX_UPLOAD_PEM_BYTES = 65_536

const trackFromUploadSchema = z.object({
  pem: z
    .string()
    .min(1)
    .max(MAX_UPLOAD_PEM_BYTES, 'Certificate data exceeds the 64 KB limit')
    .refine((s) => s.includes('-----BEGIN'), {
      message: 'Certificate must be in PEM format (-----BEGIN CERTIFICATE----- …)',
    }),
  host: z.string().max(255).optional(),
  port: z.number().int().min(0).max(65535).optional(),
  serverName: z.string().max(255).optional(),
})

export type TrackCertificateResult =
  | { success: true; certificateId: string }
  | { success: false; alreadyTracked: true; certificateId: string }
  | { error: string }

function buildDetailsFromParsed(parsed: ParsedCertificate): CertificateDetails {
  return {
    subject: parsed.subject,
    issuer: parsed.issuer,
    serialNumber: parsed.serialNumber,
    signatureAlgorithm: parsed.signatureAlgorithm,
    keyAlgorithm: parsed.keySize ? `${parsed.keyAlgorithm}-${parsed.keySize}` : parsed.keyAlgorithm,
    isSelfSigned: parsed.isSelfSigned,
    chain: parsed.chain.map((c) => ({
      subject: c.subject,
      issuer: c.issuer,
      not_before: c.notBefore,
      not_after: c.notAfter,
      fingerprint_sha256: c.fingerprintSha256,
    })),
  }
}

function sanValues(parsed: ParsedCertificate): string[] {
  return parsed.sans.map((s) => s.value).filter((v) => v.length > 0)
}

async function findExistingCertByIdentity(
  orgId: string,
  host: string,
  port: number,
  serverName: string,
  fingerprintSha256: string,
): Promise<Certificate | undefined> {
  return db.query.certificates.findFirst({
    where: and(
      eq(certificates.organisationId, orgId),
      eq(certificates.host, host),
      eq(certificates.port, port),
      eq(certificates.serverName, serverName),
      eq(certificates.fingerprintSha256, fingerprintSha256),
      isNull(certificates.deletedAt),
    ),
  })
}

export async function trackCertificateFromUrl(
  orgId: string,
  input: unknown,
): Promise<TrackCertificateResult> {
  await requireFeature(orgId, 'certExpiryTracker')
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) {
    return { error: 'Organisation mismatch' }
  }
  if (!trackFromUrlLimiter.check(orgId)) {
    return { error: 'Too many requests — please wait before adding more certificates.' }
  }

  const parsed = trackFromUrlSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { url, refreshIntervalSeconds = 3600 } = parsed.data

  let result
  try {
    const { host } = resolveUrlTarget(url)
    await assertPublicHost(host)
    result = await fetchCertificateFromUrl(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch certificate'
    return { error: message }
  }

  const { certificate, host, port, serverName } = result
  const notAfter = new Date(certificate.notAfter)
  const notBefore = new Date(certificate.notBefore)
  const status = computeExpiryStatus(notAfter)

  const existing = await findExistingCertByIdentity(
    orgId, host, port, serverName, certificate.fingerprintSha256,
  )
  if (existing) {
    if (existing.trackedUrl !== url || existing.refreshIntervalSeconds !== refreshIntervalSeconds) {
      await db
        .update(certificates)
        .set({
          trackedUrl: url,
          refreshIntervalSeconds,
          lastRefreshedAt: new Date(),
          lastRefreshError: null,
          updatedAt: new Date(),
        })
        .where(eq(certificates.id, existing.id))
    }
    return { success: false, alreadyTracked: true, certificateId: existing.id }
  }

  const [inserted] = await db
    .insert(certificates)
    .values({
      organisationId: orgId,
      source: 'imported',
      host,
      port,
      serverName,
      commonName: certificate.commonName || host,
      issuer: certificate.issuerCommonName || certificate.issuer,
      sans: sanValues(certificate),
      notBefore,
      notAfter,
      fingerprintSha256: certificate.fingerprintSha256,
      status,
      details: buildDetailsFromParsed(certificate),
      trackedUrl: url,
      refreshIntervalSeconds,
      lastRefreshedAt: new Date(),
    })
    .returning({ id: certificates.id })

  if (!inserted) return { error: 'Failed to insert certificate' }

  await db.insert(certificateEvents).values({
    organisationId: orgId,
    certificateId: inserted.id,
    eventType: 'discovered',
    newStatus: status,
    message: `Certificate tracked from URL ${url} (CN: ${certificate.commonName || host})`,
  })

  return { success: true, certificateId: inserted.id }
}

export async function trackCertificateFromUpload(
  orgId: string,
  input: unknown,
): Promise<TrackCertificateResult> {
  await requireFeature(orgId, 'certExpiryTracker')
  const session = await getRequiredSession()
  if (session.user.organisationId !== orgId) {
    return { error: 'Organisation mismatch' }
  }

  const parsed = trackFromUploadSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { pem, host: hostOverride, port: portOverride, serverName: serverNameOverride } = parsed.data

  let certificate: ParsedCertificate
  try {
    certificate = parseCertificateBuffer(Buffer.from(pem, 'utf8'))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse certificate'
    return { error: message }
  }

  const fallback = certificate.commonName || certificate.fingerprintSha256
  const host = (hostOverride && hostOverride.trim()) || fallback
  const port = portOverride ?? 0
  const serverName = (serverNameOverride && serverNameOverride.trim()) || fallback

  const notAfter = new Date(certificate.notAfter)
  const notBefore = new Date(certificate.notBefore)
  const status = computeExpiryStatus(notAfter)

  const existing = await findExistingCertByIdentity(
    orgId, host, port, serverName, certificate.fingerprintSha256,
  )
  if (existing) {
    return { success: false, alreadyTracked: true, certificateId: existing.id }
  }

  const [inserted] = await db
    .insert(certificates)
    .values({
      organisationId: orgId,
      source: 'imported',
      host,
      port,
      serverName,
      commonName: certificate.commonName || fallback,
      issuer: certificate.issuerCommonName || certificate.issuer,
      sans: sanValues(certificate),
      notBefore,
      notAfter,
      fingerprintSha256: certificate.fingerprintSha256,
      status,
      details: buildDetailsFromParsed(certificate),
    })
    .returning({ id: certificates.id })

  if (!inserted) return { error: 'Failed to insert certificate' }

  await db.insert(certificateEvents).values({
    organisationId: orgId,
    certificateId: inserted.id,
    eventType: 'discovered',
    newStatus: status,
    message: `Certificate imported from upload (CN: ${certificate.commonName || fallback})`,
  })

  return { success: true, certificateId: inserted.id }
}
