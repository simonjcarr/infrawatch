'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import {
  organisations,
  hosts,
  taskRuns,
  taskRunHosts,
  softwarePackages,
  softwareScans,
  savedSoftwareReports,
  hostGroupMembers,
  hostGroups,
} from '@/lib/db/schema'
import { eq, and, isNull, desc, sql, ilike, count, countDistinct, gte, lte, inArray } from 'drizzle-orm'
import type {
  SoftwarePackage,
  SoftwareScan,
  SavedSoftwareReport,
  SoftwareInventorySettings,
} from '@/lib/db/schema'
import { getRequiredSession } from '@/lib/auth/session'
import { escapeLikePattern } from '@/lib/utils'
import { compareVersions } from '@/lib/version-compare'

const ADMIN_ROLES = ['org_admin', 'super_admin']

// ── Settings ──────────────────────────────────────────────────────────────────

const softwareInventorySettingsSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(720),
  includeSnapFlatpak: z.boolean().optional(),
  includeWindowsStore: z.boolean().optional(),
})

export async function getSoftwareInventorySettings(
  orgId: string,
): Promise<SoftwareInventorySettings> {
  const org = await db.query.organisations.findFirst({
    where: and(eq(organisations.id, orgId), isNull(organisations.deletedAt)),
    columns: { metadata: true },
  })
  return (
    org?.metadata?.softwareInventorySettings ?? {
      enabled: false,
      intervalHours: 24,
    }
  )
}

export async function updateSoftwareInventorySettings(
  orgId: string,
  settings: SoftwareInventorySettings,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = softwareInventorySettingsSchema.safeParse(settings)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' }
  }

  try {
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { metadata: true },
    })
    const currentMetadata = org?.metadata ?? {}
    await db
      .update(organisations)
      .set({
        metadata: { ...currentMetadata, softwareInventorySettings: parsed.data },
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, orgId))
    return { success: true }
  } catch (err) {
    console.error('Failed to update software inventory settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// ── Triggering scans ──────────────────────────────────────────────────────────

export async function triggerSoftwareScan(
  orgId: string,
  hostId: string,
): Promise<{ success: true; taskRunId: string } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
      columns: { id: true },
    })
    if (!host) return { error: 'Host not found' }

    return await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(taskRuns)
        .values({
          organisationId: orgId,
          triggeredBy: session.user.id,
          targetType: 'host',
          targetId: hostId,
          taskType: 'software_inventory',
          config: {},
          maxParallel: 1,
        })
        .returning()

      if (!run) return { error: 'Failed to create task run' }

      await tx.insert(taskRunHosts).values({
        organisationId: orgId,
        taskRunId: run.id,
        hostId,
        status: 'pending',
      })

      return { success: true as const, taskRunId: run.id }
    })
  } catch (err) {
    console.error('Failed to trigger software scan:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// ── Host inventory ────────────────────────────────────────────────────────────

export interface HostSoftwareInventory {
  packages: SoftwarePackage[]
  lastScan: SoftwareScan | null
  settings: SoftwareInventorySettings
  activeScan: 'pending' | 'running' | null
}

export async function getHostSoftwareInventory(
  orgId: string,
  hostId: string,
  includeRemoved = false,
): Promise<HostSoftwareInventory> {
  const [packages, scans, settings, activeTaskRows] = await Promise.all([
    db.query.softwarePackages.findMany({
      where: and(
        eq(softwarePackages.organisationId, orgId),
        eq(softwarePackages.hostId, hostId),
        isNull(softwarePackages.deletedAt),
        ...(includeRemoved ? [] : [isNull(softwarePackages.removedAt)]),
      ),
      orderBy: [softwarePackages.name],
    }),
    db.query.softwareScans.findMany({
      where: and(
        eq(softwareScans.organisationId, orgId),
        eq(softwareScans.hostId, hostId),
      ),
      orderBy: [desc(softwareScans.createdAt)],
      limit: 1,
    }),
    getSoftwareInventorySettings(orgId),
    db
      .select({ status: taskRunHosts.status })
      .from(taskRunHosts)
      .innerJoin(
        taskRuns,
        and(
          eq(taskRuns.id, taskRunHosts.taskRunId),
          eq(taskRuns.taskType, 'software_inventory'),
          isNull(taskRuns.deletedAt),
        ),
      )
      .where(
        and(
          eq(taskRunHosts.hostId, hostId),
          eq(taskRunHosts.organisationId, orgId),
          inArray(taskRunHosts.status, ['pending', 'running']),
          isNull(taskRunHosts.deletedAt),
        ),
      )
      .limit(1),
  ])

  const activeRow = activeTaskRows[0]
  const activeScan = activeRow
    ? (activeRow.status as 'pending' | 'running')
    : null

  return { packages, lastScan: scans[0] ?? null, settings, activeScan }
}

// ── Global report search ──────────────────────────────────────────────────────

export interface PackageNameSuggestion {
  name: string
  hostCount: number
}

export async function searchPackageNames(
  orgId: string,
  q: string,
): Promise<PackageNameSuggestion[]> {
  if (!q || q.length < 2 || q.length > 100) return []

  const escaped = `%${escapeLikePattern(q)}%`

  const rows = await db
    .select({
      name: softwarePackages.name,
      hostCount: countDistinct(softwarePackages.hostId),
    })
    .from(softwarePackages)
    .where(
      and(
        eq(softwarePackages.organisationId, orgId),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
        ilike(softwarePackages.name, escaped),
      ),
    )
    .groupBy(softwarePackages.name)
    .orderBy(desc(countDistinct(softwarePackages.hostId)))
    .limit(20)

  return rows.map((r) => ({ name: r.name, hostCount: Number(r.hostCount) }))
}

export type VersionMode = 'any' | 'exact' | 'prefix' | 'between'

export interface SoftwareReportFilters {
  name?: string
  versionMode?: VersionMode
  versionExact?: string
  versionPrefix?: string
  versionLow?: string
  versionHigh?: string
  hostGroupIds?: string[]
  source?: string
  osFamily?: string
  maxScanAgeDays?: number
  page?: number
  pageSize?: number
}

export interface SoftwareReportRow {
  name: string
  version: string
  hostCount: number
  sources: string[]
  hostIds: string[]
  hostNames: string[]
}

export interface SoftwareReportResult {
  rows: SoftwareReportRow[]
  total: number
  uniquePackages: number
  hostsWithData: number
}

export async function getSoftwareReport(
  orgId: string,
  filters: SoftwareReportFilters = {},
): Promise<SoftwareReportResult> {
  const page = filters.page ?? 1
  const pageSize = Math.min(filters.pageSize ?? 50, 200)
  const offset = (page - 1) * pageSize

  // Build the base where conditions
  const conditions = [
    eq(softwarePackages.organisationId, orgId),
    isNull(softwarePackages.removedAt),
    isNull(softwarePackages.deletedAt),
  ]

  if (filters.name) {
    conditions.push(ilike(softwarePackages.name, `%${escapeLikePattern(filters.name)}%`))
  }

  if (filters.source) {
    conditions.push(eq(softwarePackages.source, filters.source as never))
  }

  if (filters.maxScanAgeDays) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - filters.maxScanAgeDays)
    conditions.push(gte(softwarePackages.lastSeenAt, cutoff))
  }

  // Fetch packages (with host join for names)
  const packages = await db
    .select({
      id: softwarePackages.id,
      name: softwarePackages.name,
      version: softwarePackages.version,
      source: softwarePackages.source,
      hostId: softwarePackages.hostId,
      hostname: hosts.hostname,
      displayName: hosts.displayName,
      os: hosts.os,
    })
    .from(softwarePackages)
    .innerJoin(hosts, and(eq(hosts.id, softwarePackages.hostId), isNull(hosts.deletedAt)))
    .where(and(...conditions))
    .orderBy(softwarePackages.name, softwarePackages.version)

  // Post-filter by version (done in JS since version comparison is pragmatic)
  let filtered = packages
  if (filters.versionMode === 'exact' && filters.versionExact) {
    filtered = filtered.filter((p) => p.version === filters.versionExact)
  } else if (filters.versionMode === 'prefix' && filters.versionPrefix) {
    filtered = filtered.filter((p) => p.version.startsWith(filters.versionPrefix!))
  } else if (filters.versionMode === 'between' && filters.versionLow && filters.versionHigh) {
    filtered = filtered.filter((p) =>
      compareVersions(p.version, filters.versionLow!) >= 0 &&
      compareVersions(p.version, filters.versionHigh!) <= 0,
    )
  }

  // Filter by host group if needed
  if (filters.hostGroupIds && filters.hostGroupIds.length > 0) {
    const members = await db
      .select({ hostId: hostGroupMembers.hostId })
      .from(hostGroupMembers)
      .where(
        and(
          eq(hostGroupMembers.organisationId, orgId),
          inArray(hostGroupMembers.groupId, filters.hostGroupIds),
          isNull(hostGroupMembers.deletedAt),
        ),
      )
    const memberHostIds = new Set(members.map((m) => m.hostId))
    filtered = filtered.filter((p) => memberHostIds.has(p.hostId))
  }

  // Filter by OS family
  if (filters.osFamily) {
    filtered = filtered.filter((p) =>
      p.os?.toLowerCase().includes(filters.osFamily!.toLowerCase()),
    )
  }

  // Group by (name, version) for the default "by package" view
  const grouped = new Map<string, SoftwareReportRow>()
  const hostIdsWithData = new Set<string>()

  for (const pkg of filtered) {
    const key = `${pkg.name}\0${pkg.version}`
    hostIdsWithData.add(pkg.hostId)
    const existing = grouped.get(key)
    if (existing) {
      existing.hostCount++
      existing.hostIds.push(pkg.hostId)
      existing.hostNames.push(pkg.displayName ?? pkg.hostname)
      if (!existing.sources.includes(pkg.source)) existing.sources.push(pkg.source)
    } else {
      grouped.set(key, {
        name: pkg.name,
        version: pkg.version,
        hostCount: 1,
        sources: [pkg.source],
        hostIds: [pkg.hostId],
        hostNames: [pkg.displayName ?? pkg.hostname],
      })
    }
  }

  const allRows = [...grouped.values()].sort((a, b) => {
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  })

  const total = allRows.length
  const rows = allRows.slice(offset, offset + pageSize)

  return {
    rows,
    total,
    uniquePackages: grouped.size,
    hostsWithData: hostIdsWithData.size,
  }
}

// ── New-in-window ─────────────────────────────────────────────────────────────

export interface NewPackageRow {
  name: string
  hostCount: number
  firstSeenAt: Date
  sources: string[]
}

export async function getNewPackages(
  orgId: string,
  windowDays: 7 | 30 = 7,
): Promise<NewPackageRow[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - windowDays)

  const rows = await db
    .select({
      name: softwarePackages.name,
      source: softwarePackages.source,
      hostId: softwarePackages.hostId,
      firstSeenAt: softwarePackages.firstSeenAt,
    })
    .from(softwarePackages)
    .where(
      and(
        eq(softwarePackages.organisationId, orgId),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
        gte(softwarePackages.firstSeenAt, cutoff),
      ),
    )
    .orderBy(desc(softwarePackages.firstSeenAt))

  const grouped = new Map<string, NewPackageRow>()
  for (const row of rows) {
    const existing = grouped.get(row.name)
    if (existing) {
      existing.hostCount++
      if (!existing.sources.includes(row.source)) existing.sources.push(row.source)
    } else {
      grouped.set(row.name, {
        name: row.name,
        hostCount: 1,
        firstSeenAt: row.firstSeenAt,
        sources: [row.source],
      })
    }
  }

  return [...grouped.values()].sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
}

// ── Package drift ─────────────────────────────────────────────────────────────

export interface DriftRow {
  groupId: string
  groupName: string
  packageName: string
  versionCount: number
  versions: string[]
}

export async function getPackageDrift(orgId: string): Promise<DriftRow[]> {
  const rows = await db
    .select({
      groupId: hostGroupMembers.groupId,
      groupName: hostGroups.name,
      packageName: softwarePackages.name,
      version: softwarePackages.version,
    })
    .from(softwarePackages)
    .innerJoin(
      hostGroupMembers,
      and(
        eq(hostGroupMembers.hostId, softwarePackages.hostId),
        eq(hostGroupMembers.organisationId, orgId),
        isNull(hostGroupMembers.deletedAt),
      ),
    )
    .innerJoin(
      hostGroups,
      and(eq(hostGroups.id, hostGroupMembers.groupId), isNull(hostGroups.deletedAt)),
    )
    .where(
      and(
        eq(softwarePackages.organisationId, orgId),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
      ),
    )

  // Group in JS and find where a group has multiple versions of the same package
  const grouped = new Map<string, { groupId: string; groupName: string; packageName: string; versions: Set<string> }>()
  for (const row of rows) {
    const key = `${row.groupId}\0${row.packageName}`
    const existing = grouped.get(key)
    if (existing) {
      existing.versions.add(row.version)
    } else {
      grouped.set(key, {
        groupId: row.groupId,
        groupName: row.groupName,
        packageName: row.packageName,
        versions: new Set([row.version]),
      })
    }
  }

  return [...grouped.values()]
    .filter((g) => g.versions.size > 1)
    .map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      packageName: g.packageName,
      versionCount: g.versions.size,
      versions: [...g.versions],
    }))
    .sort((a, b) => b.versionCount - a.versionCount)
    .slice(0, 100)
}

// ── Package details (single package, all hosts) ────────────────────────────────

export interface PackageHostInfo {
  hostId: string
  hostname: string
  displayName: string | null
  os: string | null
  osVersion: string | null
  source: string
  architecture: string | null
  version: string
  lastSeenAt: Date
}

export interface PackageVersionGroup {
  version: string
  hosts: PackageHostInfo[]
}

export interface PackageDetailsResult {
  packageName: string
  totalHosts: number
  versionGroups: PackageVersionGroup[]
}

export async function getPackageDetails(
  orgId: string,
  packageName: string,
  osFamily?: string,
): Promise<PackageDetailsResult> {
  const packages = await db
    .select({
      hostId: softwarePackages.hostId,
      version: softwarePackages.version,
      source: softwarePackages.source,
      architecture: softwarePackages.architecture,
      lastSeenAt: softwarePackages.lastSeenAt,
      hostname: hosts.hostname,
      displayName: hosts.displayName,
      os: hosts.os,
      osVersion: hosts.osVersion,
    })
    .from(softwarePackages)
    .innerJoin(hosts, and(eq(hosts.id, softwarePackages.hostId), isNull(hosts.deletedAt)))
    .where(
      and(
        eq(softwarePackages.organisationId, orgId),
        eq(softwarePackages.name, packageName),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
      ),
    )
    .orderBy(softwarePackages.version, hosts.hostname)

  let filtered = packages
  if (osFamily) {
    filtered = filtered.filter((p) =>
      p.os?.toLowerCase().includes(osFamily.toLowerCase()),
    )
  }

  const versionMap = new Map<string, PackageHostInfo[]>()
  const hostIds = new Set<string>()

  for (const pkg of filtered) {
    hostIds.add(pkg.hostId)
    const info: PackageHostInfo = {
      hostId: pkg.hostId,
      hostname: pkg.hostname,
      displayName: pkg.displayName,
      os: pkg.os,
      osVersion: pkg.osVersion,
      source: pkg.source,
      architecture: pkg.architecture,
      version: pkg.version,
      lastSeenAt: pkg.lastSeenAt,
    }
    const existing = versionMap.get(pkg.version)
    if (existing) {
      existing.push(info)
    } else {
      versionMap.set(pkg.version, [info])
    }
  }

  const versionGroups: PackageVersionGroup[] = [...versionMap.entries()]
    .map(([version, hostList]) => ({ version, hosts: hostList }))
    .sort((a, b) => compareVersions(b.version, a.version))

  return {
    packageName,
    totalHosts: hostIds.size,
    versionGroups,
  }
}

export async function getPackageVersions(
  orgId: string,
  packageName: string,
): Promise<string[]> {
  const rows = await db
    .select({ version: softwarePackages.version })
    .from(softwarePackages)
    .where(
      and(
        eq(softwarePackages.organisationId, orgId),
        eq(softwarePackages.name, packageName),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
      ),
    )
    .groupBy(softwarePackages.version)
    .orderBy(softwarePackages.version)

  return rows.map((r) => r.version).sort((a, b) => compareVersions(b, a))
}

// ── Compare two hosts ─────────────────────────────────────────────────────────

export interface HostCompareResult {
  onlyInA: SoftwarePackage[]
  onlyInB: SoftwarePackage[]
  differentVersion: Array<{ name: string; versionA: string; versionB: string }>
}

export async function compareHosts(
  orgId: string,
  hostIdA: string,
  hostIdB: string,
): Promise<HostCompareResult> {
  const [pkgsA, pkgsB] = await Promise.all([
    db.query.softwarePackages.findMany({
      where: and(
        eq(softwarePackages.organisationId, orgId),
        eq(softwarePackages.hostId, hostIdA),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
      ),
    }),
    db.query.softwarePackages.findMany({
      where: and(
        eq(softwarePackages.organisationId, orgId),
        eq(softwarePackages.hostId, hostIdB),
        isNull(softwarePackages.removedAt),
        isNull(softwarePackages.deletedAt),
      ),
    }),
  ])

  const mapA = new Map(pkgsA.map((p) => [p.name, p]))
  const mapB = new Map(pkgsB.map((p) => [p.name, p]))

  const onlyInA: SoftwarePackage[] = []
  const onlyInB: SoftwarePackage[] = []
  const differentVersion: Array<{ name: string; versionA: string; versionB: string }> = []

  for (const [name, pkgA] of mapA) {
    const pkgB = mapB.get(name)
    if (!pkgB) {
      onlyInA.push(pkgA)
    } else if (pkgA.version !== pkgB.version) {
      differentVersion.push({ name, versionA: pkgA.version, versionB: pkgB.version })
    }
  }
  for (const [name, pkgB] of mapB) {
    if (!mapA.has(name)) onlyInB.push(pkgB)
  }

  return { onlyInA, onlyInB, differentVersion }
}

// ── Saved reports ─────────────────────────────────────────────────────────────

const savedReportFiltersSchema = z.object({
  name: z.string().optional(),
  versionMode: z.enum(['any', 'exact', 'prefix', 'between']).optional(),
  versionExact: z.string().optional(),
  versionPrefix: z.string().optional(),
  versionLow: z.string().optional(),
  versionHigh: z.string().optional(),
  hostGroupIds: z.array(z.string()).optional(),
  source: z.string().optional(),
  osFamily: z.string().optional(),
  maxScanAgeDays: z.number().optional(),
})

const saveReportSchema = z.object({
  name: z.string().min(1).max(100),
  filters: savedReportFiltersSchema,
})

export async function listSavedReports(orgId: string): Promise<SavedSoftwareReport[]> {
  const session = await getRequiredSession()
  return db.query.savedSoftwareReports.findMany({
    where: and(
      eq(savedSoftwareReports.organisationId, orgId),
      eq(savedSoftwareReports.userId, session.user.id),
      isNull(savedSoftwareReports.deletedAt),
    ),
    orderBy: [desc(savedSoftwareReports.updatedAt)],
  })
}

export async function saveSoftwareReport(
  orgId: string,
  name: string,
  filters: SoftwareReportFilters,
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await getRequiredSession()
  const parsed = saveReportSchema.safeParse({ name, filters })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  try {
    const [row] = await db
      .insert(savedSoftwareReports)
      .values({
        organisationId: orgId,
        userId: session.user.id,
        name: parsed.data.name,
        filters: parsed.data.filters,
      })
      .returning()
    return { success: true, id: row!.id }
  } catch (err) {
    console.error('Failed to save report:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteSavedReport(
  orgId: string,
  reportId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  try {
    await db
      .update(savedSoftwareReports)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(savedSoftwareReports.id, reportId),
          eq(savedSoftwareReports.organisationId, orgId),
          eq(savedSoftwareReports.userId, session.user.id),
        ),
      )
    return { success: true }
  } catch (err) {
    console.error('Failed to delete saved report:', err)
    return { error: 'An unexpected error occurred' }
  }
}
