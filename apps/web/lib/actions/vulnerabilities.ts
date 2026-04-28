'use server'

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireOrgAccess } from '@/lib/actions/action-auth'
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

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

