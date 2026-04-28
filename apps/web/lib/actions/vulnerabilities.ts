'use server'

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireOrgAccess, requireOrgAdminAccess } from '@/lib/actions/action-auth'
import { requireFeature } from '@/lib/actions/licence-guard'
import { createRateLimiter } from '@/lib/rate-limit'

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown'

export interface VulnerabilityReportFilters {
  cve?: string
  packageName?: string
  severity?: VulnerabilitySeverity | 'all'
  kevOnly?: boolean
  fixAvailable?: boolean
  hostGroupId?: string
  distro?: string
  source?: string
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
  firstSeenAt: Date
  lastSeenAt: Date
}

export interface VulnerabilitySyncSource {
  id: string
  status: 'pending' | 'success' | 'error'
  lastAttemptAt: Date | null
  lastSuccessAt: Date | null
  lastError: string | null
  recordsUpserted: number
}

export interface VulnerabilityManagementFilters {
  query?: string
  severity?: VulnerabilitySeverity | 'all'
  source?: string
  kevOnly?: boolean
}

export interface VulnerabilityCatalogRow {
  cveId: string
  title: string | null
  description: string | null
  severity: VulnerabilitySeverity
  cvssScore: number | null
  publishedAt: Date | null
  modifiedAt: Date | null
  knownExploited: boolean
  rejected: boolean
  source: string | null
  affectedPackageCount: number
  openFindingCount: number
}

export interface VulnerabilitySourceStatus extends VulnerabilitySyncSource {
  lastModified: string | null
  hasCacheValidator: boolean
}

export interface VulnerabilityManagementSnapshot {
  generatedAt: Date
  summary: {
    totalCves: number
    criticalCount: number
    highCount: number
    knownExploitedCount: number
    rejectedCount: number
    affectedPackageRules: number
    openFindings: number
  }
  sourceSummary: {
    total: number
    connected: number
    pending: number
    error: number
  }
  sources: VulnerabilitySourceStatus[]
  cves: VulnerabilityCatalogRow[]
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
  sources: VulnerabilitySyncSource[]
}

const reportLimiter = createRateLimiter({
  scope: 'vulnerabilities:report',
  windowMs: 60_000,
  max: 20,
})

const managementLimiter = createRateLimiter({
  scope: 'vulnerabilities:management',
  windowMs: 60_000,
  max: 30,
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
}).strip()

const managementFiltersSchema = z.object({
  query: z.string().trim().max(120).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'none', 'unknown', 'all']).optional(),
  source: z.string().trim().max(80).optional(),
  kevOnly: z.boolean().optional(),
}).strip()

export async function getVulnerabilityManagementSnapshot(
  orgId: string,
  filters: VulnerabilityManagementFilters = {},
): Promise<VulnerabilityManagementSnapshot> {
  await requireOrgAdminAccess(orgId)
  if (!await managementLimiter.check(orgId)) {
    throw new Error('Too many vulnerability management requests. Please wait before trying again.')
  }

  const parsed = managementFiltersSchema.parse(filters)
  const conditions = vulnerabilityCatalogWhere(parsed)
  const where = sql.join(conditions, sql` AND `)

  const [summaryRowsRaw, sourceRowsRaw, cveRowsRaw] = await Promise.all([
    db.execute(sql`
      SELECT
        cast(count(*) as int) AS "totalCves",
        cast(count(*) FILTER (WHERE severity = 'critical') as int) AS "criticalCount",
        cast(count(*) FILTER (WHERE severity = 'high') as int) AS "highCount",
        cast(count(*) FILTER (WHERE known_exploited = true) as int) AS "knownExploitedCount",
        cast(count(*) FILTER (WHERE rejected = true) as int) AS "rejectedCount",
        cast((SELECT count(*) FROM vulnerability_affected_packages) as int) AS "affectedPackageRules",
        cast((SELECT count(*) FROM host_vulnerability_findings WHERE organisation_id = ${orgId} AND status = 'open') as int) AS "openFindings"
      FROM vulnerability_cves
    `),
    db.execute(sql`
      SELECT
        id,
        status,
        last_modified AS "lastModified",
        last_attempt_at AS "lastAttemptAt",
        last_success_at AS "lastSuccessAt",
        last_error AS "lastError",
        records_upserted AS "recordsUpserted",
        (etag IS NOT NULL OR last_modified IS NOT NULL) AS "hasCacheValidator"
      FROM vulnerability_sources
      ORDER BY id ASC
    `),
    db.execute(sql`
      SELECT
        vc.cve_id AS "cveId",
        vc.title,
        vc.description,
        vc.severity,
        vc.cvss_score AS "cvssScore",
        vc.published_at AS "publishedAt",
        vc.modified_at AS "modifiedAt",
        vc.known_exploited AS "knownExploited",
        vc.rejected,
        vc.source,
        cast(count(DISTINCT vap.id) as int) AS "affectedPackageCount",
        cast(count(DISTINCT hvf.id) FILTER (WHERE hvf.status = 'open') as int) AS "openFindingCount"
      FROM vulnerability_cves vc
      LEFT JOIN vulnerability_affected_packages vap ON vap.cve_id = vc.cve_id
      LEFT JOIN host_vulnerability_findings hvf
        ON hvf.cve_id = vc.cve_id
       AND hvf.organisation_id = ${orgId}
      WHERE ${where}
      GROUP BY
        vc.cve_id,
        vc.title,
        vc.description,
        vc.severity,
        vc.cvss_score,
        vc.published_at,
        vc.modified_at,
        vc.known_exploited,
        vc.rejected,
        vc.source,
        vc.updated_at
      ORDER BY COALESCE(vc.modified_at, vc.published_at, vc.updated_at) DESC, vc.cve_id ASC
      LIMIT 200
    `),
  ])

  const summaryRows = summaryRowsRaw as unknown as Array<VulnerabilityManagementSnapshot['summary']>
  const sourceRows = sourceRowsRaw as unknown as VulnerabilitySourceStatus[]
  const cveRows = cveRowsRaw as unknown as VulnerabilityCatalogRow[]

  const summary = summaryRows[0] ?? {
    totalCves: 0,
    criticalCount: 0,
    highCount: 0,
    knownExploitedCount: 0,
    rejectedCount: 0,
    affectedPackageRules: 0,
    openFindings: 0,
  }

  return {
    generatedAt: new Date(),
    summary,
    sourceSummary: {
      total: sourceRows.length,
      connected: sourceRows.filter((row) => row.status === 'success').length,
      pending: sourceRows.filter((row) => row.status === 'pending').length,
      error: sourceRows.filter((row) => row.status === 'error').length,
    },
    sources: sourceRows.map((row) => ({
      ...row,
      lastError: sanitizeSourceError(row.lastError),
    })),
    cves: cveRows,
  }
}

export async function getVulnerabilityReport(
  orgId: string,
  filters: VulnerabilityReportFilters = {},
): Promise<VulnerabilityReport> {
  await requireOrgAccess(orgId)
  await requireFeature(orgId, 'reportsExport')
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

  const sources = (await db.execute(sql`
    SELECT
      id,
      status,
      last_attempt_at AS "lastAttemptAt",
      last_success_at AS "lastSuccessAt",
      last_error AS "lastError",
      records_upserted AS "recordsUpserted"
    FROM vulnerability_sources
    ORDER BY id ASC
  `)) as unknown as VulnerabilitySyncSource[]

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
    sources,
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
      hvf.first_seen_at AS "firstSeenAt",
      hvf.last_seen_at AS "lastSeenAt"
    FROM host_vulnerability_findings hvf
    JOIN hosts h ON h.id = hvf.host_id AND h.deleted_at IS NULL
    JOIN software_packages sp ON sp.id = hvf.software_package_id
    LEFT JOIN vulnerability_cves vc ON vc.cve_id = hvf.cve_id
    WHERE hvf.organisation_id = ${orgId}
      AND hvf.host_id = ${hostId}
      AND hvf.status = 'open'
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

function vulnerabilityWhere(orgId: string, filters: z.infer<typeof filtersSchema>) {
  const conditions = [
    sql`hvf.organisation_id = ${orgId}`,
    sql`hvf.status = 'open'`,
  ]
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

function vulnerabilityCatalogWhere(filters: z.infer<typeof managementFiltersSchema>) {
  const conditions = [sql`true`]
  if (filters.query) {
    const value = `%${escapeLike(filters.query)}%`
    conditions.push(sql`(vc.cve_id ILIKE ${value} OR vc.title ILIKE ${value} OR vc.description ILIKE ${value})`)
  }
  if (filters.severity && filters.severity !== 'all') {
    conditions.push(sql`vc.severity = ${filters.severity}`)
  }
  if (filters.source) {
    conditions.push(sql`vc.source = ${filters.source}`)
  }
  if (filters.kevOnly) {
    conditions.push(sql`vc.known_exploited = true`)
  }
  return conditions
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function sanitizeSourceError(value: string | null) {
  if (!value) return null
  const httpStatus = value.match(/\bHTTP\s+(\d{3})\b/i)
  if (httpStatus) return `Upstream returned HTTP ${httpStatus[1]}`

  const lower = value.toLowerCase()
  if (lower.includes('timeout') || lower.includes('deadline exceeded')) return 'Request timed out'
  if (
    lower.includes('no such host') ||
    lower.includes('connection refused') ||
    lower.includes('connection reset') ||
    lower.includes('dial tcp') ||
    lower.includes('tls')
  ) {
    return 'Connection failed'
  }
  if (lower.includes('parse') || lower.includes('invalid') || lower.includes('unexpected end')) {
    return 'Response parsing failed'
  }
  return 'Sync failed'
}
