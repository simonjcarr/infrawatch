import { createHash, createHmac, randomUUID } from 'node:crypto'

import type { Database } from '../../db/index.ts'
import type { PackageSource } from '../../db/schema/software.ts'
import {
  recordCtCveConnectionError,
  recordCtCveInventoryPush,
  type CtCveConnectionStatusRepository,
} from './connection-status.ts'

export interface CtCveInventoryHostRecord {
  id: string
  hostname: string
  displayName: string | null
  os: string | null
  osVersion: string | null
  arch: string | null
  status: 'online' | 'offline' | 'unknown'
  lastSeenAt: Date | null
  updatedAt: Date
  deletedAt: Date | null
}

export interface CtCveInventoryPackageRecord {
  id: string
  hostId: string
  name: string
  version: string
  architecture: string | null
  source: PackageSource
  distroId: string | null
  distroVersionId: string | null
  distroCodename: string | null
  distroIdLike: string[] | null
  sourceName: string | null
  sourceVersion: string | null
  packageEpoch: string | null
  packageRelease: string | null
  repository: string | null
  origin: string | null
  firstSeenAt: Date
  lastSeenAt: Date
  removedAt: Date | null
  deletedAt: Date | null
}

export interface CtCveInventoryRepository {
  getInstance(instanceId: string): Promise<{ id: string; slug: string } | null>
  listInventoryHosts(instanceId: string, options: { limit: number; afterId?: string }): Promise<CtCveInventoryHostRecord[]>
  listInventoryPackages(instanceId: string, options: { limit: number; afterId?: string }): Promise<CtCveInventoryPackageRecord[]>
}

export interface CtCveInventorySnapshot {
  contractVersion: '2026-04-30'
  instanceId: string
  orgSlug: string
  snapshotId: string
  snapshotType: 'full' | 'incremental'
  generatedAt: string
  cursor: string | null
  hosts: Array<{
    hostId: string
    hostname: string
    displayName: string | null
    os: string | null
    osVersion: string | null
    arch: string | null
    status: 'online' | 'offline' | 'unknown'
    lastSeenAt: string | null
    updatedAt: string
  }>
  packages: Array<{
    softwarePackageId: string
    hostId: string
    name: string
    version: string
    architecture: string | null
    source: PackageSource
    fingerprint: string
    distroId: string | null
    distroVersionId: string | null
    distroCodename: string | null
    distroIdLike: string[]
    sourceName: string | null
    sourceVersion: string | null
    packageEpoch: string | null
    packageRelease: string | null
    repository: string | null
    origin: string | null
    firstSeenAt: string
    lastSeenAt: string
  }>
}

export interface CtCveInventoryPushResult {
  accepted: boolean
  snapshotId: string
  hostsAccepted: number
  packagesAccepted: number
  rowsRejected: number
  nextAction: string
}

interface CursorState {
  hostAfterId?: string
  packageAfterId?: string
}

const CONTRACT_VERSION = '2026-04-30'
const DEFAULT_HOST_LIMIT = 500
const DEFAULT_PACKAGE_LIMIT = 25_000
const INVENTORY_PATH = '/api/v1/ct-ops/inventory-snapshots'

function encodeCursor(state: CursorState): string | null {
  if (!state.hostAfterId && !state.packageAfterId) {
    return null
  }
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): CursorState {
  if (!cursor) {
    return {}
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const record = parsed as Record<string, unknown>
    return {
      hostAfterId: typeof record.hostAfterId === 'string' ? record.hostAfterId : undefined,
      packageAfterId: typeof record.packageAfterId === 'string' ? record.packageAfterId : undefined,
    }
  } catch {
    return {}
  }
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function packageFingerprint(row: CtCveInventoryPackageRecord): string {
  return [row.hostId, row.name, row.version, row.architecture ?? '', row.source].join('\0')
}

function snapshotIdFor(instanceId: string, generatedAt: Date, cursor: string | undefined) {
  const compact = generatedAt.toISOString().replace(/[-:.]/g, '').replace('T', '_').replace('Z', '')
  const pageSuffix = cursor
    ? `_page_${createHash('sha256').update(cursor).digest('base64url').slice(0, 12)}`
    : ''
  return `inv_${compact}_${instanceId}${pageSuffix}`
}

export async function buildCtCveInventorySnapshot(options: {
  instanceId: string
  cursor?: string
  snapshotType?: 'full' | 'incremental'
  generatedAt?: Date
  limits?: { hosts?: number; packages?: number }
  repository?: CtCveInventoryRepository
}): Promise<CtCveInventorySnapshot> {
  const instanceId = options.instanceId.trim()
  if (!instanceId) {
    throw new Error('instanceId is required to build a CT-CVE inventory snapshot')
  }

  const repository = options.repository ?? await getDefaultRepository()
  const instance = await repository.getInstance(instanceId)
  if (!instance) {
    throw new Error('instance not found for CT-CVE inventory snapshot')
  }

  const hostLimit = Math.min(Math.max(options.limits?.hosts ?? DEFAULT_HOST_LIMIT, 1), DEFAULT_HOST_LIMIT)
  const packageLimit = Math.min(Math.max(options.limits?.packages ?? DEFAULT_PACKAGE_LIMIT, 1), DEFAULT_PACKAGE_LIMIT)
  const cursor = decodeCursor(options.cursor)

  const [hostRows, packageRows] = await Promise.all([
    repository.listInventoryHosts(instanceId, { limit: hostLimit, afterId: cursor.hostAfterId }),
    repository.listInventoryPackages(instanceId, { limit: packageLimit, afterId: cursor.packageAfterId }),
  ])

  const activeHosts = hostRows.filter((row) => row.deletedAt === null)
  const activePackages = packageRows.filter((row) => row.deletedAt === null && row.removedAt === null)
  const nextCursor = encodeCursor({
    hostAfterId: hostRows.length >= hostLimit ? hostRows.at(-1)?.id : undefined,
    packageAfterId: packageRows.length >= packageLimit ? packageRows.at(-1)?.id : undefined,
  })
  const generatedAt = options.generatedAt ?? new Date()

  return {
    contractVersion: CONTRACT_VERSION,
    instanceId,
    orgSlug: instance.slug,
    snapshotId: snapshotIdFor(instanceId, generatedAt, options.cursor),
    snapshotType: options.snapshotType ?? 'full',
    generatedAt: generatedAt.toISOString(),
    cursor: nextCursor,
    hosts: activeHosts.map((row) => ({
      hostId: row.id,
      hostname: row.hostname,
      displayName: row.displayName,
      os: row.os,
      osVersion: row.osVersion,
      arch: row.arch,
      status: row.status,
      lastSeenAt: iso(row.lastSeenAt),
      updatedAt: row.updatedAt.toISOString(),
    })),
    packages: activePackages.map((row) => ({
      softwarePackageId: row.id,
      hostId: row.hostId,
      name: row.name,
      version: row.version,
      architecture: row.architecture,
      source: row.source,
      fingerprint: packageFingerprint(row),
      distroId: row.distroId,
      distroVersionId: row.distroVersionId,
      distroCodename: row.distroCodename,
      distroIdLike: row.distroIdLike ?? [],
      sourceName: row.sourceName,
      sourceVersion: row.sourceVersion,
      packageEpoch: row.packageEpoch,
      packageRelease: row.packageRelease,
      repository: row.repository,
      origin: row.origin,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    })),
  }
}

export async function pushCtCveInventorySnapshot(options: {
  baseUrl: string
  token: { id: string; secret: string; instanceId: string; scopes: string[] }
  snapshot: CtCveInventorySnapshot
  nonce?: string
  timestamp?: string
  fetchImpl?: typeof fetch
  statusRepository?: CtCveConnectionStatusRepository
}): Promise<CtCveInventoryPushResult> {
  if (options.token.instanceId !== options.snapshot.instanceId || !options.token.scopes.includes('inventory:write')) {
    throw new Error('CT-CVE inventory token is not scoped to this snapshot')
  }

  const url = new URL(INVENTORY_PATH, options.baseUrl)
  const body = JSON.stringify(options.snapshot)
  const timestamp = options.timestamp ?? new Date().toISOString()
  const nonce = options.nonce ?? randomUUID()
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const signature = createHmac('sha256', options.token.secret)
    .update(['POST', url.pathname, timestamp, nonce, bodyHash].join('\n'))
    .digest('base64url')

  const response = await (options.fetchImpl ?? fetch)(url.toString(), {
    method: 'POST',
    headers: {
      authorization: `CT-ServiceToken ${options.token.id}`,
      'content-type': 'application/json',
      'x-ct-timestamp': timestamp,
      'x-ct-nonce': nonce,
      'x-ct-content-sha256': bodyHash,
      'x-ct-signature': `v1=${signature}`,
    },
    body,
  })

  const payload = await response.json().catch(() => null) as CtCveInventoryPushResult | null
  if (!response.ok || !payload || typeof payload.accepted !== 'boolean') {
    await recordCtCveConnectionError(options.snapshot.instanceId, 'inventory_push_failed', {
      repository: options.statusRepository,
    })
    throw new Error(`CT-CVE inventory snapshot push failed with HTTP ${response.status}`)
  }
  await recordCtCveInventoryPush(options.snapshot.instanceId, {
    repository: options.statusRepository,
  })
  return payload
}

async function getDefaultRepository(): Promise<CtCveInventoryRepository> {
  const { db: database } = await import('../../db/index.ts')
  return createDrizzleCtCveInventoryRepository(database)
}

function createDrizzleCtCveInventoryRepository(database: Database): CtCveInventoryRepository {
  return {
    async getInstance(instanceId) {
      const { and, eq, isNull } = await import('drizzle-orm')
      const { instanceSettings } = await import('../../db/schema/index.ts')
      const [row] = await database
        .select({ id: instanceSettings.id, slug: instanceSettings.slug })
        .from(instanceSettings)
        .where(and(eq(instanceSettings.id, instanceId), isNull(instanceSettings.deletedAt)))
        .limit(1)
      return row ?? null
    },
    async listInventoryHosts(instanceId, options) {
      const { and, asc, eq, gt, isNull } = await import('drizzle-orm')
      const { hosts } = await import('../../db/schema/index.ts')
      return database
        .select({
          id: hosts.id,
          hostname: hosts.hostname,
          displayName: hosts.displayName,
          os: hosts.os,
          osVersion: hosts.osVersion,
          arch: hosts.arch,
          status: hosts.status,
          lastSeenAt: hosts.lastSeenAt,
          updatedAt: hosts.updatedAt,
          deletedAt: hosts.deletedAt,
        })
        .from(hosts)
        .where(and(
          eq(hosts.instanceId, instanceId),
          isNull(hosts.deletedAt),
          options.afterId ? gt(hosts.id, options.afterId) : undefined,
        ))
        .orderBy(asc(hosts.id))
        .limit(options.limit)
    },
    async listInventoryPackages(instanceId, options) {
      const { and, asc, eq, gt, isNull } = await import('drizzle-orm')
      const { hosts, softwarePackages } = await import('../../db/schema/index.ts')
      return database
        .select({
          id: softwarePackages.id,
          hostId: softwarePackages.hostId,
          name: softwarePackages.name,
          version: softwarePackages.version,
          architecture: softwarePackages.architecture,
          source: softwarePackages.source,
          distroId: softwarePackages.distroId,
          distroVersionId: softwarePackages.distroVersionId,
          distroCodename: softwarePackages.distroCodename,
          distroIdLike: softwarePackages.distroIdLike,
          sourceName: softwarePackages.sourceName,
          sourceVersion: softwarePackages.sourceVersion,
          packageEpoch: softwarePackages.packageEpoch,
          packageRelease: softwarePackages.packageRelease,
          repository: softwarePackages.repository,
          origin: softwarePackages.origin,
          firstSeenAt: softwarePackages.firstSeenAt,
          lastSeenAt: softwarePackages.lastSeenAt,
          removedAt: softwarePackages.removedAt,
          deletedAt: softwarePackages.deletedAt,
        })
        .from(softwarePackages)
        .innerJoin(hosts, eq(hosts.id, softwarePackages.hostId))
        .where(and(
          eq(softwarePackages.instanceId, instanceId),
          isNull(softwarePackages.removedAt),
          isNull(softwarePackages.deletedAt),
          isNull(hosts.deletedAt),
          options.afterId ? gt(softwarePackages.id, options.afterId) : undefined,
        ))
        .orderBy(asc(softwarePackages.id))
        .limit(options.limit)
    },
  }
}
