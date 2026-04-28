'use server'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requireOrgAccess } from '@/lib/actions/action-auth'
import { requireFeature } from '@/lib/actions/licence-guard'

export interface PatchPackageUpdate {
  id: string
  name: string
  currentVersion: string | null
  availableVersion: string | null
  architecture: string | null
  repository: string | null
  packageManager: string | null
  firstSeenAt: Date
  lastSeenAt: Date
}

export interface HostPatchStatusDetails {
  id: string
  hostId: string
  status: 'pass' | 'fail' | 'error' | 'unknown'
  lastPatchedAt: Date | null
  patchAgeDays: number | null
  maxAgeDays: number
  packageManager: string | null
  updatesSupported: boolean
  updatesCount: number
  updatesTruncated: boolean
  warnings: string[]
  error: string | null
  checkedAt: Date
  updates: PatchPackageUpdate[]
}

export interface PatchReportHostRow extends HostPatchStatusDetails {
  hostname: string
  displayName: string | null
  os: string | null
  osVersion: string | null
  networkIds: string[]
  networkNames: string[]
}

export interface PatchReportNetworkRow {
  networkId: string
  networkName: string
  hostCount: number
  passingCount: number
  failingCount: number
  errorCount: number
  unknownCount: number
  averagePatchAgeDays: number | null
  oldestPatchAgeDays: number | null
}

export interface PatchManagementReport {
  generatedAt: Date
  summary: {
    totalHosts: number
    passingCount: number
    failingCount: number
    errorCount: number
    unknownCount: number
    averagePatchAgeDays: number | null
    oldestPatchAgeDays: number | null
    totalAvailableUpdates: number
  }
  networks: PatchReportNetworkRow[]
  hosts: PatchReportHostRow[]
}

type HostPatchRow = {
  id: string
  host_id: string
  status: 'pass' | 'fail' | 'error' | 'unknown'
  last_patched_at: Date | null
  patch_age_days: number | null
  max_age_days: number
  package_manager: string | null
  updates_supported: boolean
  updates_count: number
  updates_truncated: boolean
  warnings: string[] | null
  error: string | null
  checked_at: Date
}

function toHostPatchStatus(row: HostPatchRow, updates: PatchPackageUpdate[]): HostPatchStatusDetails {
  return {
    id: row.id,
    hostId: row.host_id,
    status: row.status,
    lastPatchedAt: row.last_patched_at,
    patchAgeDays: row.patch_age_days,
    maxAgeDays: row.max_age_days,
    packageManager: row.package_manager,
    updatesSupported: row.updates_supported,
    updatesCount: row.updates_count,
    updatesTruncated: row.updates_truncated,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    error: row.error,
    checkedAt: row.checked_at,
    updates,
  }
}

export async function getHostPatchStatus(
  orgId: string,
  hostId: string,
): Promise<HostPatchStatusDetails | null> {
  await requireOrgAccess(orgId)

  const rows = (await db.execute(sql`
    SELECT
      hps.id,
      hps.host_id,
      hps.status,
      hps.last_patched_at,
      hps.patch_age_days,
      hps.max_age_days,
      hps.package_manager,
      hps.updates_supported,
      hps.updates_count,
      hps.updates_truncated,
      hps.warnings,
      hps.error,
      hps.checked_at
    FROM host_patch_statuses hps
    JOIN hosts h ON h.id = hps.host_id
    WHERE hps.organisation_id = ${orgId}
      AND hps.host_id = ${hostId}
      AND h.organisation_id = ${orgId}
      AND h.deleted_at IS NULL
    ORDER BY hps.checked_at DESC
    LIMIT 1
  `)) as unknown as HostPatchRow[]

  const row = rows[0]
  if (!row) return null

  const updates = await getCurrentUpdatesForHost(orgId, hostId)
  return toHostPatchStatus(row, updates)
}

export async function getCurrentUpdatesForHost(
  orgId: string,
  hostId: string,
): Promise<PatchPackageUpdate[]> {
  await requireOrgAccess(orgId)

  const rows = (await db.execute(sql`
    SELECT
      id,
      name,
      current_version AS "currentVersion",
      available_version AS "availableVersion",
      architecture,
      repository,
      package_manager AS "packageManager",
      first_seen_at AS "firstSeenAt",
      last_seen_at AS "lastSeenAt"
    FROM host_package_updates
    WHERE organisation_id = ${orgId}
      AND host_id = ${hostId}
      AND status = 'current'
    ORDER BY name ASC
    LIMIT 500
  `)) as unknown as PatchPackageUpdate[]

  return rows
}

export async function getPatchManagementReport(orgId: string): Promise<PatchManagementReport> {
  await requireOrgAccess(orgId)
  await requireFeature(orgId, 'reportsExport')

  const rows = (await db.execute(sql`
    SELECT
      h.id AS host_id,
      h.hostname,
      h.display_name,
      h.os,
      h.os_version,
      hps.id,
      COALESCE(hps.status, 'unknown') AS status,
      hps.last_patched_at,
      hps.patch_age_days,
      COALESCE(hps.max_age_days, 30) AS max_age_days,
      hps.package_manager,
      COALESCE(hps.updates_supported, false) AS updates_supported,
      COALESCE(hps.updates_count, 0) AS updates_count,
      COALESCE(hps.updates_truncated, false) AS updates_truncated,
      hps.warnings,
      hps.error,
      COALESCE(hps.checked_at, h.created_at) AS checked_at,
      COALESCE(array_remove(array_agg(DISTINCT n.id), NULL), ARRAY[]::text[]) AS network_ids,
      COALESCE(array_remove(array_agg(DISTINCT n.name), NULL), ARRAY[]::text[]) AS network_names
    FROM hosts h
    LEFT JOIN LATERAL (
      SELECT *
      FROM host_patch_statuses latest
      WHERE latest.host_id = h.id
        AND latest.organisation_id = h.organisation_id
      ORDER BY latest.checked_at DESC
      LIMIT 1
    ) hps ON true
    LEFT JOIN host_network_memberships hnm
      ON hnm.host_id = h.id
     AND hnm.organisation_id = h.organisation_id
     AND hnm.deleted_at IS NULL
    LEFT JOIN networks n
      ON n.id = hnm.network_id
     AND n.organisation_id = h.organisation_id
     AND n.deleted_at IS NULL
    WHERE h.organisation_id = ${orgId}
      AND h.deleted_at IS NULL
    GROUP BY h.id, hps.id, hps.status, hps.last_patched_at, hps.patch_age_days,
      hps.max_age_days, hps.package_manager, hps.updates_supported,
      hps.updates_count, hps.updates_truncated, hps.warnings, hps.error, hps.checked_at
    ORDER BY
      CASE COALESCE(hps.status, 'unknown')
        WHEN 'fail' THEN 0
        WHEN 'error' THEN 1
        WHEN 'unknown' THEN 2
        ELSE 3
      END,
      hps.patch_age_days DESC NULLS LAST,
      h.hostname ASC
  `)) as unknown as Array<HostPatchRow & {
    hostname: string
    display_name: string | null
    os: string | null
    os_version: string | null
    network_ids: string[]
    network_names: string[]
  }>

  const hosts: PatchReportHostRow[] = rows.map((row) => ({
    ...toHostPatchStatus({
      id: row.id ?? row.host_id,
      host_id: row.host_id,
      status: row.status,
      last_patched_at: row.last_patched_at,
      patch_age_days: row.patch_age_days,
      max_age_days: row.max_age_days,
      package_manager: row.package_manager,
      updates_supported: row.updates_supported,
      updates_count: row.updates_count,
      updates_truncated: row.updates_truncated,
      warnings: row.warnings,
      error: row.error,
      checked_at: row.checked_at,
    }, []),
    hostname: row.hostname,
    displayName: row.display_name,
    os: row.os,
    osVersion: row.os_version,
    networkIds: row.network_ids ?? [],
    networkNames: row.network_names ?? [],
  }))

  const summary = summariseHosts(hosts)
  return {
    generatedAt: new Date(),
    summary,
    networks: summariseNetworks(hosts),
    hosts,
  }
}

function summariseHosts(hosts: PatchReportHostRow[]) {
  const ages = hosts.map((h) => h.patchAgeDays).filter((age): age is number => typeof age === 'number')
  return {
    totalHosts: hosts.length,
    passingCount: hosts.filter((h) => h.status === 'pass').length,
    failingCount: hosts.filter((h) => h.status === 'fail').length,
    errorCount: hosts.filter((h) => h.status === 'error').length,
    unknownCount: hosts.filter((h) => h.status === 'unknown').length,
    averagePatchAgeDays: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    oldestPatchAgeDays: ages.length ? Math.max(...ages) : null,
    totalAvailableUpdates: hosts.reduce((total, host) => total + host.updatesCount, 0),
  }
}

function summariseNetworks(hosts: PatchReportHostRow[]): PatchReportNetworkRow[] {
  const grouped = new Map<string, { name: string; hosts: PatchReportHostRow[] }>()
  for (const host of hosts) {
    host.networkIds.forEach((networkId, index) => {
      const name = host.networkNames[index] ?? 'Unnamed network'
      const existing = grouped.get(networkId)
      if (existing) {
        existing.hosts.push(host)
      } else {
        grouped.set(networkId, { name, hosts: [host] })
      }
    })
  }

  return [...grouped.entries()]
    .map(([networkId, group]) => {
      const summary = summariseHosts(group.hosts)
      return {
        networkId,
        networkName: group.name,
        hostCount: summary.totalHosts,
        passingCount: summary.passingCount,
        failingCount: summary.failingCount,
        errorCount: summary.errorCount,
        unknownCount: summary.unknownCount,
        averagePatchAgeDays: summary.averagePatchAgeDays,
        oldestPatchAgeDays: summary.oldestPatchAgeDays,
      }
    })
    .sort((a, b) => b.failingCount - a.failingCount || a.networkName.localeCompare(b.networkName))
}
