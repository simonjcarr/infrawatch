'use server'

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { parseHostMetadata } from '@/lib/db/schema/hosts'
import { requireOrgAccess } from '@/lib/actions/action-auth'
import { createRateLimiter } from '@/lib/rate-limit'
import {
  deriveHostVulnerabilityAssessmentStatus,
  type HostVulnerabilityAssessmentStatus,
} from '@/lib/vulnerabilities/assessment'
import { getCtCveConnectionStatus } from '@/lib/integrations/ct-cve/connection-status'

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown'
export type VulnerabilityFindingConfidence = 'confirmed' | 'probable' | 'unsupported'

export interface VulnerabilityReportFilters {
  cve?: string
  packageName?: string
  severity?: VulnerabilitySeverity | 'all'
  kevOnly?: boolean
  fixAvailable?: boolean
  hostGroupId?: string
  distro?: string
  source?: string
  confidence?: VulnerabilityFindingConfidence | 'all'
}

export interface VulnerabilityFindingRow {
  id: string
  hostId: string
  hostname: string
  displayName: string | null
  os: string | null
  osVersion: string | null
  cveId: string
  description: string | null
  packageName: string
  installedVersion: string
  fixedVersion: string | null
  source: string
  distroId: string | null
  distroVersionId: string | null
  distroCodename: string | null
  severity: VulnerabilitySeverity
  cvssScore: number | null
  knownExploited: boolean
  confidence: VulnerabilityFindingConfidence
  matchReason: string | null
  firstSeenAt: Date
  lastSeenAt: Date
}

export interface VulnerabilityReport {
  generatedAt: Date
  summary: {
    openFindings: number
    affectedHosts: number
    criticalCount: number
    highCount: number
    knownExploitedCount: number
    fixAvailableCount: number
  }
  findings: VulnerabilityFindingRow[]
}

export interface HostVulnerabilityAssessment {
  status: HostVulnerabilityAssessmentStatus
  reason: string
  openConfirmedFindings: number
  criticalCount: number
  highCount: number
  knownExploitedCount: number
  fixAvailableCount: number
  inventoryStale: boolean
  findingImportStale: boolean
  lastInventoryScanAt: Date | null
  lastFindingImportAt: Date | null
  lastFindingSeenAt: Date | null
  lastAssessedAt: Date | null
}

const reportLimiter = createRateLimiter({
  scope: 'vulnerabilities:report',
  windowMs: 60_000,
  max: 20,
})

const filtersSchema = z.object({
  cve: z.string().trim().max(32).optional(),
  packageName: z.string().trim().max(120).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'none', 'unknown', 'all']).optional(),
  kevOnly: z.boolean().optional(),
  fixAvailable: z.boolean().optional(),
  hostGroupId: z.string().trim().max(64).optional(),
  distro: z.string().trim().max(64).optional(),
  source: z.string().trim().max(64).optional(),
  confidence: z.enum(['confirmed', 'probable', 'unsupported', 'all']).optional(),
}).strip()

export async function getVulnerabilityReport(
  orgId: string,
  filters: VulnerabilityReportFilters = {},
): Promise<VulnerabilityReport> {
  await requireOrgAccess(orgId)
  if (!await reportLimiter.check(orgId)) {
    throw new Error('Too many vulnerability report requests. Please wait before trying again.')
  }

  const parsed = filtersSchema.parse(filters)
  const conditions = vulnerabilityWhere(orgId, parsed)
  const where = sql.join(conditions, sql` AND `)

  const findings = (await db.execute(sql`
    SELECT
      hvf.id,
      hvf.host_id AS "hostId",
      h.hostname,
      h.display_name AS "displayName",
      h.os,
      h.os_version AS "osVersion",
      hvf.cve_id AS "cveId",
      vc.description,
      hvf.package_name AS "packageName",
      hvf.installed_version AS "installedVersion",
      hvf.fixed_version AS "fixedVersion",
      hvf.source,
      sp.distro_id AS "distroId",
      sp.distro_version_id AS "distroVersionId",
      sp.distro_codename AS "distroCodename",
      hvf.severity,
      hvf.cvss_score AS "cvssScore",
      hvf.known_exploited AS "knownExploited",
      hvf.confidence,
      hvf.match_reason AS "matchReason",
      hvf.first_seen_at AS "firstSeenAt",
      hvf.last_seen_at AS "lastSeenAt"
    FROM host_vulnerability_findings hvf
    JOIN hosts h ON h.id = hvf.host_id AND h.deleted_at IS NULL
    JOIN software_packages sp ON sp.id = hvf.software_package_id
    LEFT JOIN vulnerability_cves vc ON vc.cve_id = hvf.cve_id
    WHERE ${where}
    ORDER BY
      CASE hvf.severity
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END,
      hvf.known_exploited DESC,
      hvf.last_seen_at DESC
    LIMIT 1000
  `)) as unknown as VulnerabilityFindingRow[]

  const hostIds = new Set(findings.map((row) => row.hostId))
  return {
    generatedAt: new Date(),
    summary: {
      openFindings: findings.length,
      affectedHosts: hostIds.size,
      criticalCount: findings.filter((row) => row.severity === 'critical').length,
      highCount: findings.filter((row) => row.severity === 'high').length,
      knownExploitedCount: findings.filter((row) => row.knownExploited).length,
      fixAvailableCount: findings.filter((row) => Boolean(row.fixedVersion)).length,
    },
    findings,
  }
}

export async function getHostVulnerabilities(
  orgId: string,
  hostId: string,
): Promise<VulnerabilityFindingRow[]> {
  await requireOrgAccess(orgId)

  return (await db.execute(sql`
    SELECT
      hvf.id,
      hvf.host_id AS "hostId",
      h.hostname,
      h.display_name AS "displayName",
      h.os,
      h.os_version AS "osVersion",
      hvf.cve_id AS "cveId",
      vc.description,
      hvf.package_name AS "packageName",
      hvf.installed_version AS "installedVersion",
      hvf.fixed_version AS "fixedVersion",
      hvf.source,
      sp.distro_id AS "distroId",
      sp.distro_version_id AS "distroVersionId",
      sp.distro_codename AS "distroCodename",
      hvf.severity,
      hvf.cvss_score AS "cvssScore",
      hvf.known_exploited AS "knownExploited",
      hvf.confidence,
      hvf.match_reason AS "matchReason",
      hvf.first_seen_at AS "firstSeenAt",
      hvf.last_seen_at AS "lastSeenAt"
    FROM host_vulnerability_findings hvf
    JOIN hosts h ON h.id = hvf.host_id AND h.deleted_at IS NULL
    JOIN software_packages sp ON sp.id = hvf.software_package_id
    LEFT JOIN vulnerability_cves vc ON vc.cve_id = hvf.cve_id
    WHERE hvf.organisation_id = ${orgId}
      AND hvf.host_id = ${hostId}
      AND hvf.status = 'open'
      AND hvf.confidence = 'confirmed'
    ORDER BY
      CASE hvf.severity
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END,
      hvf.known_exploited DESC,
      hvf.last_seen_at DESC
    LIMIT 500
  `)) as unknown as VulnerabilityFindingRow[]
}

export async function getHostVulnerabilityAssessment(
  orgId: string,
  hostId: string,
): Promise<HostVulnerabilityAssessment> {
  await requireOrgAccess(orgId)

  const [hostRowsRaw, findingRowsRaw, scanRowsRaw, connectionStatus] = await Promise.all([
    db.execute(sql`
      SELECT metadata
      FROM hosts
      WHERE id = ${hostId}
        AND organisation_id = ${orgId}
        AND deleted_at IS NULL
      LIMIT 1
    `),
    db.execute(sql`
      SELECT
        cast(count(*) as int) AS "openConfirmedFindings",
        cast(count(*) FILTER (WHERE severity = 'critical') as int) AS "criticalCount",
        cast(count(*) FILTER (WHERE severity = 'high') as int) AS "highCount",
        cast(count(*) FILTER (WHERE known_exploited = true) as int) AS "knownExploitedCount",
        cast(count(*) FILTER (WHERE fixed_version IS NOT NULL) as int) AS "fixAvailableCount",
        max(last_seen_at) AS "lastFindingSeenAt"
      FROM host_vulnerability_findings
      WHERE organisation_id = ${orgId}
        AND host_id = ${hostId}
        AND status = 'open'
        AND confidence = 'confirmed'
    `),
    db.execute(sql`
      SELECT completed_at AS "completedAt"
      FROM software_scans
      WHERE organisation_id = ${orgId}
        AND host_id = ${hostId}
        AND status = 'success'
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `),
    getCtCveConnectionStatus(orgId, { configured: false }),
  ])

  const hostRows = hostRowsRaw as unknown as Array<{ metadata: unknown }>
  const findingRows = findingRowsRaw as unknown as Array<{
    openConfirmedFindings: number
    criticalCount: number
    highCount: number
    knownExploitedCount: number
    fixAvailableCount: number
    lastFindingSeenAt: Date | string | null
  }>
  const scanRows = scanRowsRaw as unknown as Array<{ completedAt: Date | string | null }>

  const metadata = parseHostMetadata(hostRows[0]?.metadata)
  const lastInventoryScanAt = coerceDate(scanRows[0]?.completedAt) ?? coerceDate(metadata.lastSoftwareScanAt)
  const lastFindingImportAt = coerceDate(connectionStatus.lastFindingIngestAt)
  const summary = findingRows[0] ?? {
    openConfirmedFindings: 0,
    criticalCount: 0,
    highCount: 0,
    knownExploitedCount: 0,
    fixAvailableCount: 0,
    lastFindingSeenAt: null,
  }
  const lastFindingSeenAt = coerceDate(summary.lastFindingSeenAt)
  const derived = deriveHostVulnerabilityAssessmentStatus({
    openConfirmedFindings: summary.openConfirmedFindings,
    lastInventoryScanAt,
    lastFindingImportAt,
  })

  return {
    status: derived.status,
    reason: derived.reason,
    openConfirmedFindings: summary.openConfirmedFindings,
    criticalCount: summary.criticalCount,
    highCount: summary.highCount,
    knownExploitedCount: summary.knownExploitedCount,
    fixAvailableCount: summary.fixAvailableCount,
    inventoryStale: derived.inventoryStale,
    findingImportStale: derived.findingImportStale,
    lastInventoryScanAt,
    lastFindingImportAt,
    lastFindingSeenAt,
    lastAssessedAt: lastFindingSeenAt ?? lastInventoryScanAt,
  }
}

function vulnerabilityWhere(orgId: string, filters: z.infer<typeof filtersSchema>) {
  const conditions = [
    sql`hvf.organisation_id = ${orgId}`,
    sql`hvf.status = 'open'`,
  ]
  if (!filters.confidence || filters.confidence === 'confirmed') {
    conditions.push(sql`hvf.confidence = 'confirmed'`)
  } else if (filters.confidence !== 'all') {
    conditions.push(sql`hvf.confidence = ${filters.confidence}`)
  }
  if (filters.cve) {
    conditions.push(sql`hvf.cve_id ILIKE ${`%${escapeLike(filters.cve)}%`}`)
  }
  if (filters.packageName) {
    conditions.push(sql`hvf.package_name ILIKE ${`%${escapeLike(filters.packageName)}%`}`)
  }
  if (filters.severity && filters.severity !== 'all') {
    conditions.push(sql`hvf.severity = ${filters.severity}`)
  }
  if (filters.kevOnly) {
    conditions.push(sql`hvf.known_exploited = true`)
  }
  if (filters.fixAvailable) {
    conditions.push(sql`hvf.fixed_version IS NOT NULL`)
  }
  if (filters.distro) {
    conditions.push(sql`sp.distro_id = ${filters.distro}`)
  }
  if (filters.source) {
    conditions.push(sql`hvf.source = ${filters.source}`)
  }
  if (filters.hostGroupId) {
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM host_group_members hgm
      WHERE hgm.host_id = hvf.host_id
        AND hgm.organisation_id = hvf.organisation_id
        AND hgm.group_id = ${filters.hostGroupId}
        AND hgm.deleted_at IS NULL
    )`)
  }
  return conditions
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function coerceDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
