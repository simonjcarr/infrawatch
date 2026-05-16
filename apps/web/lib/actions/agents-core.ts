'use server'

import { logError, logWarn } from '@/lib/logging'
import { requireInstanceAccess, requireInstanceAdminAccess, requireInstanceToolingAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import {
  agents,
  agentStatusHistory,
  agentEnrolmentTokens,
  revokedCertificates,
  hosts,
  hostDockerStatus,
  dockerContainers,
  dockerContainerLifecycleEvents,
  dockerContainerMetrics,
  dockerTelemetryBatches,
  hostMetrics,
  hostGroupMembers,
  checks,
  checkResults,
  alertRules,
  alertInstances,
  alertSilences,
  notifications,
  certificates,
  certificateEvents,
  serviceAccounts,
  sshKeys,
  identityEvents,
  agentQueries,
  resourceTags,
  taskRuns,
  taskRunHosts,
  terminalSessions,
  softwarePackages,
  softwareScans,
  hostVulnerabilityFindings,
  hostNetworkMemberships,
  hostPatchStatuses,
  hostPackageUpdates,
  pendingCertSignings,
} from '@/lib/db/schema'
import { eq, and, isNull, gt, gte, lte, asc, desc, sql, inArray, ilike, or, count } from 'drizzle-orm'
import type { Agent, AgentEnrolmentToken, Host, HostDockerStatus, HostMetric } from '@/lib/db/schema'
import { HOST_HIGH_USAGE_THRESHOLD, HOST_STALE_MINUTES } from '@/lib/db/schema/hosts'
import { escapeLikePattern } from '@/lib/utils'
import { getInstanceDefaultCollectionSettings } from '@/lib/actions/host-settings'
import { triggerAgentUninstall, getTaskRun } from '@/lib/actions/task-runs-core'
import { assignTagsToResource, getInstanceDefaultTags, mergeTagLayers } from '@/lib/actions/tags'
import { runMatchingTagRules } from '@/lib/actions/tag-rules'
import type { HostMetadata, TagPair } from '@/lib/db/schema'
import { parseHostMetadata } from '@/lib/db/schema/hosts'
import { createRateLimiter } from '@/lib/rate-limit'
import { getRequiredSession } from '@/lib/auth/session'
import { hasRole } from '@/lib/auth/guards'
import {
  calculateEnrolmentTokenExpiry,
  DEFAULT_ENROLMENT_TOKEN_EXPIRY_DAYS,
  DEFAULT_ENROLMENT_TOKEN_MAX_USES,
  normaliseEnrolmentTokenLimits,
} from '@/lib/agent/enrolment-token-policy'
import { createHash } from 'crypto'
import { createId } from '@paralleldrive/cuid2'
import { writeAuditEvent } from '@/lib/audit/events'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const createEnrolmentTokenLimiter = createRateLimiter({
  scope: 'agents:create-enrolment-token',
  windowMs: 60_000,
  max: 10,
})

export type OfflinePeriod = { start: number; end: number | null }

const createEnrolmentTokenSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100),
  autoApprove: z.boolean().default(false),
  skipVerify: z.boolean().default(false),
  maxUses: z.number().int().positive().default(DEFAULT_ENROLMENT_TOKEN_MAX_USES),
  expiresInDays: z.number().int().positive().max(365).default(DEFAULT_ENROLMENT_TOKEN_EXPIRY_DAYS),
  tags: z
    .array(z.object({ key: z.string().min(1).max(100), value: z.string().min(1).max(500) }))
    .default([]),
})

async function resolveCurrentActionScope(): Promise<string> {
  const session = await getRequiredSession()
  const instanceId = session.user.instanceId
  if (!instanceId) {
    throw new Error('Instance scope is not configured')
  }
  return instanceId
}

export async function listPendingAgents(instanceId?: string): Promise<Agent[]> {
  const currentScope = instanceId ?? await resolveCurrentActionScope()
  await requireInstanceAccess(currentScope)
  return db.query.agents.findMany({
    where: and(
      eq(agents.instanceId, currentScope),
      eq(agents.status, 'pending'),
      isNull(agents.deletedAt),
    ),
  })
}

export async function approveAgent(
  agentId: string,
): Promise<{ success: true } | { error: string }>
export async function approveAgent(
  instanceId: string,
  agentId: string,
): Promise<{ success: true } | { error: string }>
export async function approveAgent(
  instanceIdOrAgentId: string,
  maybeAgentId?: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = maybeAgentId ? instanceIdOrAgentId : await resolveCurrentActionScope()
  const agentId = maybeAgentId ?? instanceIdOrAgentId
  const session = await requireInstanceToolingAccess(instanceId)
  const actorId = session.user.id
  try {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), eq(agents.instanceId, instanceId)),
    })
    if (!agent) return { error: 'Agent not found' }
    if (agent.status !== 'pending') return { error: 'Agent is not in pending state' }

    // Guard against duplicate hosts: a pending agent that shares a hostname or
    // any IP with a currently-online host in the same instance must not be approved,
    // because activating it would leave two live rows for the same physical
    // machine. The ingest register handler enforces the same rule at first
    // contact, but a collision can emerge later (e.g. another host with the
    // same hostname came online after this agent was queued for approval).
    const pendingHost = await db.query.hosts.findFirst({
      where: and(
        eq(hosts.agentId, agentId),
        eq(hosts.instanceId, instanceId),
        isNull(hosts.deletedAt),
      ),
    })
    const pendingIps = (pendingHost?.ipAddresses ?? []) as string[]
    const collision = await findOnlineHostCollision(instanceId, agentId, pendingHost?.hostname ?? agent.hostname, pendingIps)
    if (collision) {
      return {
        error: `Cannot approve: another host (${collision.hostname}) matching this hostname or IP is already online in this instance. Delete the existing host first.`,
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({
          status: 'active',
          approvedById: actorId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(agents.id, agentId), eq(agents.instanceId, instanceId)))

      await tx.insert(agentStatusHistory).values({
        agentId,
        instanceId: instanceId,
        status: 'active',
        actorId,
        reason: 'Approved by admin',
      })

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: actorId,
        action: 'agent.approved',
        targetType: 'agent',
        targetId: agent.id,
        summary: `Approved agent ${agent.hostname}`,
        metadata: {
          hostname: agent.hostname,
          previousStatus: agent.status,
          nextStatus: 'active',
          agentVersion: agent.version,
          os: agent.os,
        },
      })
    })

    // Apply host setup defaults and tag policy to the associated host (best-effort, outside transaction)
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.agentId, agentId), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
    })
    if (host) {
      // Apply instance default collection settings + drain any pendingTags the
      // ingest handler stashed at register time. pendingTags already represent
      // the (token → CLI) merge on the ingest side; here we layer instance defaults
      // underneath (weakest), then run any saved tag_rules last.
      const defaults = await getInstanceDefaultCollectionSettings(instanceId)
      const currentMetadata = parseHostMetadata(host.metadata)
      const pendingTags: TagPair[] = currentMetadata.pendingTags ?? []
      const instanceDefaultTags = await getInstanceDefaultTags(instanceId)
      const finalTags = await mergeTagLayers(instanceDefaultTags, pendingTags)

      const nextMetadata: HostMetadata = {
        ...currentMetadata,
        collectionSettings: defaults,
      }
      delete nextMetadata.pendingTags

      await db
        .update(hosts)
        .set({
          metadata: nextMetadata,
          updatedAt: new Date(),
        })
        .where(and(eq(hosts.id, host.id), eq(hosts.instanceId, instanceId)))

      if (finalTags.length > 0) {
        const result = await assignTagsToResource(instanceId, 'host', host.id, finalTags)
        if ('error' in result) {
          logWarn('Failed to apply tags on approval:', result.error)
        }
      }

      // Saved rules run last so they never overwrite explicit per-host intent.
      await runMatchingTagRules(instanceId, host.id)
    }

    return { success: true }
  } catch (err) {
    logError('Failed to approve agent:', err)
    return { error: 'An unexpected error occurred' }
  }
}

// findOnlineHostCollision returns the first online host in the instance (excluding
// the one linked to excludeAgentId) whose hostname matches or whose
// ip_addresses jsonb array overlaps any of the provided ips. Used by
// approveAgent to block activation when doing so would produce a duplicate.
async function findOnlineHostCollision(
  instanceId: string,
  excludeAgentId: string,
  hostname: string,
  ips: string[],
): Promise<{ id: string; hostname: string } | null> {
  const ipOverlap = ips.length > 0
    ? sql`${hosts.ipAddresses} ?| ARRAY[${sql.join(ips.map((ip) => sql`${ip}`), sql`, `)}]::text[]`
    : sql`false`
  return (
    await db.query.hosts.findFirst({
      columns: { id: true, hostname: true },
      where: and(
        eq(hosts.instanceId, instanceId),
        isNull(hosts.deletedAt),
        eq(hosts.status, 'online'),
        sql`(${hosts.agentId} IS NULL OR ${hosts.agentId} <> ${excludeAgentId})`,
        sql`(${hosts.hostname} = ${hostname} OR ${ipOverlap})`,
      ),
    })
  ) ?? null
}

export async function rejectAgent(
  agentId: string,
): Promise<{ success: true } | { error: string }>
export async function rejectAgent(
  instanceId: string,
  agentId: string,
): Promise<{ success: true } | { error: string }>
export async function rejectAgent(
  instanceIdOrAgentId: string,
  maybeAgentId?: string,
): Promise<{ success: true } | { error: string }> {
  const instanceId = maybeAgentId ? instanceIdOrAgentId : await resolveCurrentActionScope()
  const agentId = maybeAgentId ?? instanceIdOrAgentId
  const session = await requireInstanceToolingAccess(instanceId)
  const actorId = session.user.id
  try {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), eq(agents.instanceId, instanceId)),
    })
    if (!agent) return { error: 'Agent not found' }

    await db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(and(eq(agents.id, agentId), eq(agents.instanceId, instanceId)))

      await tx.insert(agentStatusHistory).values({
        agentId,
        instanceId: instanceId,
        status: 'revoked',
        actorId,
        reason: 'Rejected by admin',
      })

      // If the agent had an mTLS client cert, add its serial to the
      // revocation list so the ingest will reject any future handshake.
      if (agent.clientCertSerial) {
        await tx.insert(revokedCertificates).values({
          instanceId: instanceId,
          serial: agent.clientCertSerial,
          reason: 'Rejected by admin',
        }).onConflictDoNothing()
      }

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: actorId,
        action: 'agent.rejected',
        targetType: 'agent',
        targetId: agent.id,
        summary: `Rejected agent ${agent.hostname}`,
        metadata: {
          hostname: agent.hostname,
          previousStatus: agent.status,
          nextStatus: 'revoked',
          agentVersion: agent.version,
          os: agent.os,
          revokedClientCertificate: Boolean(agent.clientCertSerial),
        },
      })
    })

    return { success: true }
  } catch (err) {
    logError('Failed to reject agent:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export type HostWithAgent = Host & { agent: Agent | null; dockerStatus?: HostDockerStatus | null }

export async function listHosts(instanceId?: string): Promise<HostWithAgent[]> {
  const currentScope = instanceId ?? await resolveCurrentActionScope()
  await requireInstanceAccess(currentScope)
  const rows = await db
    .select()
    .from(hosts)
    .leftJoin(agents, eq(hosts.agentId, agents.id))
    .where(and(eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)))

  return rows.map((row) => ({
    ...row.hosts,
    agent: row.agents ?? null,
  }))
}

// ─── Paginated host inventory + stats (hosts page) ───────────────────────────
//
// listHosts above returns every host in one shot. It is used by features that
// genuinely need the whole set (network graph, terminal host picker, bulk-tag,
// group membership). The main /hosts page instead uses the paginated variant
// below so that a instance with thousands of hosts does not ship every row to
// the browser on first paint.

export type HostSortField =
  | 'hostname'
  | 'os'
  | 'status'
  | 'cpuPercent'
  | 'memoryPercent'
  | 'diskPercent'
  | 'lastSeenAt'

export type HostSortDir = 'asc' | 'desc'

export interface HostListParams {
  search?: string
  status?: 'online' | 'offline' | 'unknown'
  os?: string
  sortBy?: HostSortField
  sortDir?: HostSortDir
  limit?: number
  offset?: number
}

export interface HostListResult {
  hosts: HostWithAgent[]
  total: number
}

const HOST_PAGE_MAX = 200

export async function listHostsPaginated(params?: HostListParams): Promise<HostListResult>
export async function listHostsPaginated(
  instanceId: string,
  params?: HostListParams,
): Promise<HostListResult>
export async function listHostsPaginated(
  instanceIdOrParams?: string | HostListParams,
  maybeParams?: HostListParams,
): Promise<HostListResult> {
  const instanceId = typeof instanceIdOrParams === 'string' ? instanceIdOrParams : await resolveCurrentActionScope()
  const params = typeof instanceIdOrParams === 'string' ? (maybeParams ?? {}) : (instanceIdOrParams ?? {})
  await requireInstanceAccess(instanceId)
  const limit = Math.max(1, Math.min(params.limit ?? 50, HOST_PAGE_MAX))
  const offset = Math.max(0, params.offset ?? 0)
  const sortBy: HostSortField = params.sortBy ?? 'hostname'
  const sortDir: HostSortDir = params.sortDir ?? 'asc'

  const conditions = [eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)]

  if (params.status) {
    conditions.push(eq(hosts.status, params.status))
  }
  if (params.os) {
    conditions.push(eq(hosts.os, params.os))
  }
  if (params.search && params.search.trim().length > 0) {
    const pattern = `%${escapeLikePattern(params.search.trim())}%`
    // Cast the ip_addresses jsonb column to text so an ILIKE pattern still
    // matches substrings inside the serialised array.
    const searchClause = or(
      ilike(hosts.hostname, pattern),
      ilike(hosts.displayName, pattern),
      sql`${hosts.ipAddresses}::text ILIKE ${pattern}`,
    )
    if (searchClause) conditions.push(searchClause)
  }

  const columnMap = {
    hostname: hosts.hostname,
    os: hosts.os,
    status: hosts.status,
    cpuPercent: hosts.cpuPercent,
    memoryPercent: hosts.memoryPercent,
    diskPercent: hosts.diskPercent,
    lastSeenAt: hosts.lastSeenAt,
  } as const
  const sortColumn = columnMap[sortBy]

  // Push NULLs to the end regardless of direction — otherwise a DESC sort on a
  // mostly-empty column (e.g. diskPercent before first scrape) surfaces a wall
  // of "—" before any real data.
  const orderExpr =
    sortDir === 'desc'
      ? sql`${sortColumn} DESC NULLS LAST`
      : sql`${sortColumn} ASC NULLS LAST`

  const whereExpr = and(...conditions)

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(hosts)
      .leftJoin(agents, eq(hosts.agentId, agents.id))
      .where(whereExpr)
      .orderBy(orderExpr, asc(hosts.hostname))
      .limit(limit)
      .offset(offset),
    db
      .select({ c: count() })
      .from(hosts)
      .where(whereExpr),
  ])

  return {
    hosts: rows.map((row) => ({
      ...row.hosts,
      agent: row.agents ?? null,
    })),
    total: Number(totalRow[0]?.c ?? 0),
  }
}

export interface HostInventoryStats {
  total: number
  online: number
  offline: number
  unknown: number
  pending: number
  staleHosts: number
  highCpu: number
  highMemory: number
  highDisk: number
  hostsWithFiringAlerts: number
  osBreakdown: Array<{ os: string; count: number }>
}

export async function getHostInventoryStats(): Promise<HostInventoryStats>
export async function getHostInventoryStats(instanceId: string): Promise<HostInventoryStats>
export async function getHostInventoryStats(instanceId?: string): Promise<HostInventoryStats> {
  const currentScope = instanceId ?? await resolveCurrentActionScope()
  await requireInstanceAccess(currentScope)
  const baseWhere = and(eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt))
  const threshold = HOST_HIGH_USAGE_THRESHOLD
  const staleCutoff = new Date(Date.now() - HOST_STALE_MINUTES * 60 * 1000)

  const [summary, osRows, pendingRow, alertHostRow] = await Promise.all([
    db
      .select({
        total: count(),
        online: sql<number>`cast(count(*) filter (where ${hosts.status} = 'online') as int)`,
        offline: sql<number>`cast(count(*) filter (where ${hosts.status} = 'offline') as int)`,
        unknown: sql<number>`cast(count(*) filter (where ${hosts.status} NOT IN ('online','offline')) as int)`,
        highCpu: sql<number>`cast(count(*) filter (where ${hosts.cpuPercent} >= ${threshold}) as int)`,
        highMemory: sql<number>`cast(count(*) filter (where ${hosts.memoryPercent} >= ${threshold}) as int)`,
        highDisk: sql<number>`cast(count(*) filter (where ${hosts.diskPercent} >= ${threshold}) as int)`,
        stale: sql<number>`cast(count(*) filter (where ${hosts.lastSeenAt} IS NULL OR ${hosts.lastSeenAt} < ${staleCutoff.toISOString()}) as int)`,
      })
      .from(hosts)
      .where(baseWhere),
    db
      .select({
        os: hosts.os,
        c: count(),
      })
      .from(hosts)
      .where(baseWhere)
      .groupBy(hosts.os)
      .orderBy(desc(count())),
    db
      .select({ c: count() })
      .from(agents)
      .where(
        and(
          eq(agents.instanceId, currentScope),
          eq(agents.status, 'pending'),
          isNull(agents.deletedAt),
        ),
      ),
    db
      .select({
        c: sql<number>`cast(count(distinct ${alertInstances.hostId}) as int)`,
      })
      .from(alertInstances)
      .where(
        and(
          eq(alertInstances.instanceId, currentScope),
          eq(alertInstances.status, 'firing'),
        ),
      ),
  ])

  const row = summary[0]
  return {
    total: Number(row?.total ?? 0),
    online: Number(row?.online ?? 0),
    offline: Number(row?.offline ?? 0),
    unknown: Number(row?.unknown ?? 0),
    pending: Number(pendingRow[0]?.c ?? 0),
    staleHosts: Number(row?.stale ?? 0),
    highCpu: Number(row?.highCpu ?? 0),
    highMemory: Number(row?.highMemory ?? 0),
    highDisk: Number(row?.highDisk ?? 0),
    hostsWithFiringAlerts: Number(alertHostRow[0]?.c ?? 0),
    osBreakdown: osRows.map((r) => ({
      os: r.os ?? 'Unknown',
      count: Number(r.c),
    })),
  }
}

export async function listDistinctHostOses(): Promise<string[]>
export async function listDistinctHostOses(instanceId: string): Promise<string[]>
export async function listDistinctHostOses(instanceId?: string): Promise<string[]> {
  const currentScope = instanceId ?? await resolveCurrentActionScope()
  await requireInstanceAccess(currentScope)
  const rows = await db
    .selectDistinct({ os: hosts.os })
    .from(hosts)
    .where(and(eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)))
    .orderBy(asc(hosts.os))
  return rows.map((r) => r.os).filter((v): v is string => v !== null && v !== '')
}

export async function createEnrolmentToken(
  instanceId: string,
  input: {
    label: string
    autoApprove: boolean
    skipVerify?: boolean
    maxUses?: number
    expiresInDays?: number
    tags?: Array<{ key: string; value: string }>
  },
): Promise<{ token: string; id: string } | { error: string }> {
  const session = await requireInstanceToolingAccess(instanceId)
  const userId = session.user.id
  if (!await createEnrolmentTokenLimiter.check(instanceId)) {
    return { error: 'Too many requests — please wait before creating another enrolment token.' }
  }
  const parsed = createEnrolmentTokenSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  // autoApprove bypasses the registration approval queue — restrict to super_admin to limit
  // blast radius if an instance_admin account is compromised (M-29).
  if (parsed.data.autoApprove) {
    if (!hasRole(session.user, 'super_admin')) {
      return { error: 'Only super_admin users may create auto-approve enrolment tokens.' }
    }
  }

  try {
    const limits = normaliseEnrolmentTokenLimits(parsed.data)
    const expiresAt = calculateEnrolmentTokenExpiry(limits.expiresInDays)

    // Generate the token explicitly so we can hash it before insertion.
    // The plaintext is returned to the caller once; subsequent list queries omit it.
    const token = createId()
    const [record] = await db
      .insert(agentEnrolmentTokens)
      .values({
        instanceId: instanceId,
        label: parsed.data.label,
        createdById: userId,
        autoApprove: parsed.data.autoApprove,
        skipVerify: parsed.data.skipVerify,
        maxUses: limits.maxUses,
        expiresAt,
        metadata: parsed.data.tags.length > 0 ? { tags: parsed.data.tags } : null,
        token,
        tokenHash: hashToken(token),
      })
      .returning()

    if (!record) return { error: 'Failed to create enrolment token' }

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: userId,
      action: 'agent.enrolment_token.created',
      targetType: 'agent_enrolment_token',
      targetId: record.id,
      summary: `Created enrolment token ${record.label}`,
      metadata: {
        label: record.label,
        autoApprove: record.autoApprove,
        skipVerify: record.skipVerify,
        maxUses: record.maxUses,
        expiresAt: record.expiresAt,
        tagCount: parsed.data.tags.length,
      },
    })

    return { token: record.token, id: record.id }
  } catch (err) {
    logError('Failed to create enrolment token:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export type EnrolmentTokenForAdmin = Omit<AgentEnrolmentToken, 'tokenHash'> & {
  tokenHint: string
}

export async function listEnrolmentTokens(instanceId: string): Promise<EnrolmentTokenForAdmin[]> {
  await requireInstanceAdminAccess(instanceId)
  const rows = await db.query.agentEnrolmentTokens.findMany({
    where: and(
      eq(agentEnrolmentTokens.instanceId, instanceId),
      isNull(agentEnrolmentTokens.deletedAt),
    ),
  })
  return rows.map(({ tokenHash: _hash, ...rest }) => ({
    ...rest,
    tokenHint: rest.token.slice(-4),
  }))
}

export async function revokeEnrolmentToken(
  instanceId: string,
  tokenId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await requireInstanceToolingAccess(instanceId)
  try {
    const token = await db.query.agentEnrolmentTokens.findFirst({
      where: and(
        eq(agentEnrolmentTokens.id, tokenId),
        eq(agentEnrolmentTokens.instanceId, instanceId),
        isNull(agentEnrolmentTokens.deletedAt),
      ),
      columns: {
        id: true,
        label: true,
        autoApprove: true,
        skipVerify: true,
        maxUses: true,
        usageCount: true,
        expiresAt: true,
      },
    })
    if (!token) return { error: 'Enrolment token not found' }

    await db.transaction(async (tx) => {
      await tx
        .update(agentEnrolmentTokens)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(agentEnrolmentTokens.id, tokenId), eq(agentEnrolmentTokens.instanceId, instanceId)),
        )

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'agent.enrolment_token.revoked',
        targetType: 'agent_enrolment_token',
        targetId: token.id,
        summary: `Revoked enrolment token ${token.label}`,
        metadata: {
          label: token.label,
          autoApprove: token.autoApprove,
          skipVerify: token.skipVerify,
          maxUses: token.maxUses,
          usageCount: token.usageCount,
          expiresAt: token.expiresAt,
        },
      })
    })

    return { success: true }
  } catch (err) {
    logError('Failed to revoke enrolment token:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getActiveEnrolmentToken(token: string) {
  const now = new Date()
  return db.query.agentEnrolmentTokens.findFirst({
    where: and(
      eq(agentEnrolmentTokens.token, token),
      isNull(agentEnrolmentTokens.deletedAt),
      gt(agentEnrolmentTokens.expiresAt, now),
    ),
  })
}

export type MetricsPreset = '1h' | '6h' | '24h' | '7d' | '30d'
export type MetricsRange = MetricsPreset
export type MetricsBounds = { from: number; to: number }
export type MetricsQuery = MetricsPreset | MetricsBounds

// Maximum data points returned by any metrics query — keeps payloads small and charts fast
const MAX_DATA_POINTS = 300

// Bucket intervals in seconds from finest to coarsest (all must be clean divisors of their neighbours)
const NICE_BUCKET_INTERVALS_S = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400]

type BucketMode =
  | { kind: 'raw' }
  | { kind: 'bucket'; intervalSecs: number; useAggregate: 'hourly' | 'daily' | null }

function resolveTimeBounds(query: MetricsQuery): {
  from: Date
  to: Date
  fromISO: string
  toISO: string
} {
  let fromMs: number, toMs: number
  if (typeof query === 'string') {
    toMs = Date.now()
    const h: Record<MetricsPreset, number> = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 }
    fromMs = toMs - h[query] * 3_600_000
  } else {
    fromMs = query.from
    toMs = query.to
  }
  const from = new Date(fromMs)
  const to = new Date(toMs)
  return { from, to, fromISO: from.toISOString(), toISO: to.toISOString() }
}

// Computes the coarsest bucket that keeps point count ≤ MAX_DATA_POINTS.
// Returns 'raw' when the span is short enough that raw data fits within the cap.
function computeBucketMode(spanMs: number): BucketMode {
  const idealSecs = spanMs / (MAX_DATA_POINTS * 1000)
  if (idealSecs <= 30) {
    // Raw heartbeat interval is ~30s — raw rows will fit within the cap
    return { kind: 'raw' }
  }
  const intervalSecs = NICE_BUCKET_INTERVALS_S.find((n) => n >= idealSecs) ?? 86400
  return {
    kind: 'bucket',
    intervalSecs,
    // Use pre-computed TimescaleDB continuous aggregates when the interval exactly matches
    useAggregate: intervalSecs === 3600 ? 'hourly' : intervalSecs === 86400 ? 'daily' : null,
  }
}

// Returns a PostgreSQL interval string for use in time_bucket() calls
function bucketIntervalStr(intervalSecs: number): string {
  if (intervalSecs < 3600) return `${intervalSecs / 60} minutes`
  if (intervalSecs < 86400) return `${intervalSecs / 3600} hours`
  return `${intervalSecs / 86400} days`
}

export async function getHostMetrics(
  instanceId: string,
  hostId: string,
  query: MetricsQuery,
): Promise<HostMetric[]> {
  await requireInstanceAccess(instanceId)
  const { from, to, fromISO, toISO } = resolveTimeBounds(query)
  const bucketMode = computeBucketMode(to.getTime() - from.getTime())

  if (bucketMode.kind === 'bucket') {
    // Continuous aggregate path — fast pre-computed 1h or 1d buckets
    if (bucketMode.useAggregate != null) {
      const view = bucketMode.useAggregate === 'daily' ? 'host_metrics_daily' : 'host_metrics_hourly'
      try {
        const rows = await db.execute<{
          id: string
          instance_id: string
          host_id: string
          recorded_at: Date
          cpu_percent: number | null
          memory_percent: number | null
          disk_percent: number | null
          uptime_seconds: number | null
          created_at: Date
        }>(sql`
          SELECT
            concat(${hostId}, '-', bucket::text) AS id,
            ${instanceId}                             AS instance_id,
            ${hostId}                            AS host_id,
            bucket                               AS recorded_at,
            cpu_percent,
            memory_percent,
            disk_percent,
            NULL::integer                        AS uptime_seconds,
            bucket                               AS created_at
          FROM ${sql.identifier(view)}
          WHERE instance_id = ${instanceId}
            AND host_id         = ${hostId}
            AND bucket         >= ${fromISO}
            AND bucket         <= ${toISO}
          ORDER BY bucket ASC
          LIMIT ${MAX_DATA_POINTS}
        `)
        const rowArr = Array.from(rows)
        if (rowArr.length > 0) {
          return rowArr.map((r) => ({
            id: r.id,
            instanceId: r.instance_id,
            hostId: r.host_id,
            recordedAt: new Date(r.recorded_at),
            cpuPercent: r.cpu_percent,
            memoryPercent: r.memory_percent,
            diskPercent: r.disk_percent,
            uptimeSeconds: r.uptime_seconds,
            createdAt: new Date(r.created_at),
          }))
        }
      } catch {
        // Aggregate view not available — fall through to time_bucket
      }
    }

    // On-the-fly time_bucket for other intervals (or fallback from aggregate)
    // Use sql.raw() for the interval so every occurrence shares the same literal —
    // Drizzle's parameterised $N placeholders make PostgreSQL treat each reference as a
    // distinct expression, which breaks GROUP BY validation.
    const intervalStr = bucketIntervalStr(bucketMode.intervalSecs)
    const bucket = sql.raw(`time_bucket('${intervalStr}'::interval, recorded_at)`)
    try {
      const rows = await db.execute<{
        recorded_at: Date
        cpu_percent: number | null
        memory_percent: number | null
        disk_percent: number | null
      }>(sql`
        SELECT
          ${bucket}                  AS recorded_at,
          AVG(cpu_percent)::real     AS cpu_percent,
          AVG(memory_percent)::real  AS memory_percent,
          AVG(disk_percent)::real    AS disk_percent
        FROM host_metrics
        WHERE instance_id = ${instanceId}
          AND host_id         = ${hostId}
          AND recorded_at    >= ${fromISO}
          AND recorded_at    <= ${toISO}
        GROUP BY ${bucket}
        ORDER BY 1 ASC
        LIMIT ${MAX_DATA_POINTS}
      `)
      const rowArr = Array.from(rows)
      if (rowArr.length > 0) {
        return rowArr.map((r) => ({
          id: `${hostId}-${r.recorded_at}`,
          instanceId: instanceId,
          hostId,
          recordedAt: new Date(r.recorded_at),
          cpuPercent: r.cpu_percent,
          memoryPercent: r.memory_percent,
          diskPercent: r.disk_percent,
          uptimeSeconds: null,
          createdAt: new Date(r.recorded_at),
        }))
      }
    } catch {
      // time_bucket not available — fall through to raw
    }
  }

  // Raw path (short spans) or final fallback — always capped to prevent huge payloads
  return db.query.hostMetrics.findMany({
    where: and(
      eq(hostMetrics.instanceId, instanceId),
      eq(hostMetrics.hostId, hostId),
      gte(hostMetrics.recordedAt, from),
      lte(hostMetrics.recordedAt, to),
    ),
    orderBy: [asc(hostMetrics.recordedAt)],
    limit: MAX_DATA_POINTS,
  })
}

export async function getAgentOfflinePeriods(
  instanceId: string,
  agentId: string,
  query: MetricsQuery,
): Promise<OfflinePeriod[]> {
  await requireInstanceAccess(instanceId)
  const { from, to } = resolveTimeBounds(query)
  const windowStart = from.getTime()
  // Look back one extra hour before the window to capture an offline event that
  // started before the visible range.
  const lookback = new Date(from.getTime() - 3_600_000)

  const events = await db.query.agentStatusHistory.findMany({
    columns: { status: true, createdAt: true },
    where: and(
      eq(agentStatusHistory.agentId, agentId),
      eq(agentStatusHistory.instanceId, instanceId),
      gte(agentStatusHistory.createdAt, lookback),
      lte(agentStatusHistory.createdAt, to),
    ),
    orderBy: [asc(agentStatusHistory.createdAt)],
  })

  const periods: OfflinePeriod[] = []
  let offlineStart: number | null = null

  for (const event of events) {
    const ts = new Date(event.createdAt).getTime()
    if (event.status === 'offline') {
      // Clamp start to the visible window boundary
      offlineStart = Math.max(ts, windowStart)
    } else if (event.status === 'active' && offlineStart !== null) {
      periods.push({ start: offlineStart, end: ts })
      offlineStart = null
    }
  }

  // Agent is still offline — period extends to end of window
  if (offlineStart !== null) {
    periods.push({ start: offlineStart, end: null })
  }

  return periods
}

export type HeartbeatPoint = { time: number; intervalSecs: number }

export async function getHeartbeatHistory(
  instanceId: string,
  hostId: string,
  query: MetricsQuery,
): Promise<HeartbeatPoint[]> {
  await requireInstanceAccess(instanceId)
  const { from, to, fromISO, toISO } = resolveTimeBounds(query)
  const bucketMode = computeBucketMode(to.getTime() - from.getTime())

  if (bucketMode.kind === 'raw') {
    // Individual intervals — LAG() gives the gap between consecutive heartbeats
    const rows = await db.execute<{ recorded_at: string; interval_secs: number | null }>(sql`
      SELECT
        recorded_at,
        EXTRACT(EPOCH FROM (
          recorded_at - LAG(recorded_at) OVER (ORDER BY recorded_at)
        ))::float AS interval_secs
      FROM host_metrics
      WHERE instance_id = ${instanceId}
        AND host_id         = ${hostId}
        AND recorded_at    >= ${fromISO}
        AND recorded_at    <= ${toISO}
      ORDER BY recorded_at ASC
      LIMIT ${MAX_DATA_POINTS}
    `)
    return Array.from(rows)
      .filter((r) => r.interval_secs != null)
      .map((r) => ({
        time: new Date(r.recorded_at).getTime(),
        intervalSecs: parseFloat(Number(r.interval_secs).toFixed(1)),
      }))
  }

  // Bucketed: take the MAX gap per bucket so outages are visible even when
  // there are many healthy heartbeats within the same window.
  // Uses TimescaleDB time_bucket; falls back to raw LAG on plain PostgreSQL.
  const intervalStr = bucketIntervalStr(bucketMode.intervalSecs)
  try {
    const rows = await db.execute<{ bucket: string; max_interval_secs: number | null }>(sql`
      WITH intervals AS (
        SELECT
          recorded_at,
          EXTRACT(EPOCH FROM (
            recorded_at - LAG(recorded_at) OVER (ORDER BY recorded_at)
          ))::float AS interval_secs
        FROM host_metrics
        WHERE instance_id = ${instanceId}
          AND host_id         = ${hostId}
          AND recorded_at    >= ${fromISO}
          AND recorded_at    <= ${toISO}
      )
      SELECT
        time_bucket(${intervalStr}::interval, recorded_at) AS bucket,
        MAX(interval_secs)                                 AS max_interval_secs
      FROM intervals
      WHERE interval_secs IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT ${MAX_DATA_POINTS}
    `)
    return Array.from(rows)
      .filter((r) => r.max_interval_secs != null)
      .map((r) => ({
        time: new Date(r.bucket).getTime(),
        intervalSecs: parseFloat(Number(r.max_interval_secs).toFixed(1)),
      }))
  } catch {
    // Plain PostgreSQL fallback — raw intervals with cap
    const rows = await db.execute<{ recorded_at: string; interval_secs: number | null }>(sql`
      SELECT
        recorded_at,
        EXTRACT(EPOCH FROM (
          recorded_at - LAG(recorded_at) OVER (ORDER BY recorded_at)
        ))::float AS interval_secs
      FROM host_metrics
      WHERE instance_id = ${instanceId}
        AND host_id         = ${hostId}
        AND recorded_at    >= ${fromISO}
        AND recorded_at    <= ${toISO}
      ORDER BY recorded_at ASC
      LIMIT ${MAX_DATA_POINTS}
    `)
    return Array.from(rows)
      .filter((r) => r.interval_secs != null)
      .map((r) => ({
        time: new Date(r.recorded_at).getTime(),
        intervalSecs: parseFloat(Number(r.interval_secs).toFixed(1)),
      }))
  }
}

export async function getHost(instanceId: string, hostId: string): Promise<HostWithAgent | null> {
  await requireInstanceAccess(instanceId)
  const rows = await db
    .select({
      host: hosts,
      agent: agents,
      dockerStatus: hostDockerStatus,
    })
    .from(hosts)
    .leftJoin(agents, eq(hosts.agentId, agents.id))
    .leftJoin(
      hostDockerStatus,
      and(
        eq(hostDockerStatus.hostId, hosts.id),
        eq(hostDockerStatus.instanceId, hosts.instanceId),
      ),
    )
    .where(
      and(
        eq(hosts.id, hostId),
        eq(hosts.instanceId, instanceId),
        isNull(hosts.deletedAt),
      ),
    )
    .limit(1)

  if (rows.length === 0) return null
  const row = rows[0]!
  return {
    ...row.host,
    agent: row.agent ?? null,
    dockerStatus: row.dockerStatus ?? null,
  }
}

export async function deleteHost(
  instanceId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  await requireInstanceToolingAccess(instanceId)
  try {
    const session = await getRequiredSession()
    // Capture the result of the "not found" check that happens inside the
    // transaction so we can surface it as an error after the transaction closes.
    let hostNotFound = false

    await db.transaction(async (tx) => {
      // Lock the host row for the duration of this transaction so that
      // concurrent delete requests cannot race past this check (TOCTOU fix).
      const [host] = await tx
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId)))
        .for('update')

      if (!host) {
        hostNotFound = true
        return
      }

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'host.deleted',
        targetType: 'host',
        targetId: host.id,
        summary: `Deleted host ${host.hostname}`,
        metadata: {
          hostname: host.hostname,
          agentId: host.agentId,
          status: host.status,
        },
      })

      // 1. Identity events (references service_account_id, ssh_key_id, host_id)
      await tx
        .delete(identityEvents)
        .where(and(eq(identityEvents.hostId, hostId), eq(identityEvents.instanceId, instanceId)))

      // 2. SSH keys (references host_id, service_account_id)
      await tx
        .delete(sshKeys)
        .where(and(eq(sshKeys.hostId, hostId), eq(sshKeys.instanceId, instanceId)))

      // 3. Service accounts
      await tx
        .delete(serviceAccounts)
        .where(and(eq(serviceAccounts.hostId, hostId), eq(serviceAccounts.instanceId, instanceId)))

      // 4. Check results (references check_id which references host_id)
      await tx
        .delete(checkResults)
        .where(and(eq(checkResults.hostId, hostId), eq(checkResults.instanceId, instanceId)))

      // 5. Certificate events & certificates (certificates reference both
      //    discovered_by_host_id AND check_id, so must be deleted before checks)
      const hostCheckIds = (
        await tx.query.checks.findMany({
          columns: { id: true },
          where: and(eq(checks.hostId, hostId), eq(checks.instanceId, instanceId)),
        })
      ).map((c) => c.id)

      // Patch status summaries can reference both the host and its check rows,
      // so remove them while the check IDs are still available and before the
      // checks table is deleted.
      await tx
        .delete(hostPatchStatuses)
        .where(and(eq(hostPatchStatuses.hostId, hostId), eq(hostPatchStatuses.instanceId, instanceId)))
      await tx
        .delete(hostPackageUpdates)
        .where(and(eq(hostPackageUpdates.hostId, hostId), eq(hostPackageUpdates.instanceId, instanceId)))

      const hostCerts = await tx.query.certificates.findMany({
        columns: { id: true },
        where: and(
          eq(certificates.instanceId, instanceId),
          sql`(${certificates.discoveredByHostId} = ${hostId}${
            hostCheckIds.length > 0
              ? sql` OR ${certificates.checkId} IN (${sql.join(hostCheckIds.map((id) => sql`${id}`), sql`, `)})`
              : sql``
          })`,
        ),
      })

      if (hostCerts.length > 0) {
        const certIds = hostCerts.map((c) => c.id)
        await tx
          .delete(certificateEvents)
          .where(and(
            inArray(certificateEvents.certificateId, certIds),
            eq(certificateEvents.instanceId, instanceId),
          ))
        await tx
          .delete(certificates)
          .where(and(
            inArray(certificates.id, certIds),
            eq(certificates.instanceId, instanceId),
          ))
      }

      // 6. Checks (host-specific only — now safe, certificates removed above)
      await tx
        .delete(checks)
        .where(and(eq(checks.hostId, hostId), eq(checks.instanceId, instanceId)))

      // 7a. Notifications referencing this host's alert instances (FK constraint)
      const hostAlertInstanceIds = (
        await tx.query.alertInstances.findMany({
          columns: { id: true },
          where: and(eq(alertInstances.hostId, hostId), eq(alertInstances.instanceId, instanceId)),
        })
      ).map((instance) => instance.id)

      if (hostAlertInstanceIds.length > 0) {
        await tx
          .delete(notifications)
          .where(inArray(notifications.alertInstanceId, hostAlertInstanceIds))
      }

      // 7b. Alert instances
      await tx
        .delete(alertInstances)
        .where(and(eq(alertInstances.hostId, hostId), eq(alertInstances.instanceId, instanceId)))

      // 8. Alert silences (host-specific only)
      await tx
        .delete(alertSilences)
        .where(and(eq(alertSilences.hostId, hostId), eq(alertSilences.instanceId, instanceId)))

      // 9. Alert rules (host-specific only)
      await tx
        .delete(alertRules)
        .where(and(eq(alertRules.hostId, hostId), eq(alertRules.instanceId, instanceId)))

      // 11. Agent queries
      await tx
        .delete(agentQueries)
        .where(and(eq(agentQueries.hostId, hostId), eq(agentQueries.instanceId, instanceId)))

      // 12. Host metrics
      await tx
        .delete(hostMetrics)
        .where(and(eq(hostMetrics.hostId, hostId), eq(hostMetrics.instanceId, instanceId)))

      // 12a. Docker inventory/telemetry rows reference both the host and, for
      //      per-container data, docker_containers rows. Delete child tables
      //      first so hosts with Docker telemetry can still be removed.
      await tx
        .delete(dockerContainerMetrics)
        .where(and(eq(dockerContainerMetrics.hostId, hostId), eq(dockerContainerMetrics.instanceId, instanceId)))
      await tx
        .delete(dockerContainerLifecycleEvents)
        .where(and(eq(dockerContainerLifecycleEvents.hostId, hostId), eq(dockerContainerLifecycleEvents.instanceId, instanceId)))
      await tx
        .delete(dockerContainers)
        .where(and(eq(dockerContainers.hostId, hostId), eq(dockerContainers.instanceId, instanceId)))
      await tx
        .delete(dockerTelemetryBatches)
        .where(and(eq(dockerTelemetryBatches.hostId, hostId), eq(dockerTelemetryBatches.instanceId, instanceId)))
      await tx
        .delete(hostDockerStatus)
        .where(and(eq(hostDockerStatus.hostId, hostId), eq(hostDockerStatus.instanceId, instanceId)))

      // 13. Resource tags
      await tx
        .delete(resourceTags)
        .where(and(
          eq(resourceTags.resourceId, hostId),
          eq(resourceTags.resourceType, 'host'),
          eq(resourceTags.instanceId, instanceId),
        ))

      // 13a. Vulnerability findings reference software_packages, and software
      //      scans reference task_run_hosts, so remove in FK order.
      await tx
        .delete(hostVulnerabilityFindings)
        .where(and(eq(hostVulnerabilityFindings.hostId, hostId), eq(hostVulnerabilityFindings.instanceId, instanceId)))
      await tx
        .delete(softwarePackages)
        .where(and(eq(softwarePackages.hostId, hostId), eq(softwarePackages.instanceId, instanceId)))
      await tx
        .delete(softwareScans)
        .where(and(eq(softwareScans.hostId, hostId), eq(softwareScans.instanceId, instanceId)))

      // 13b. Task run host rows (FK to hosts; must be removed before the host
      //      is deleted or the transaction fails). Group-targeted task_runs
      //      keep their rows for other hosts; host-targeted task_runs are
      //      then removed as orphans below since they have no remaining rows.
      await tx
        .delete(taskRunHosts)
        .where(and(
          eq(taskRunHosts.hostId, hostId),
          eq(taskRunHosts.instanceId, instanceId),
        ))
      await tx
        .delete(taskRuns)
        .where(and(
          eq(taskRuns.instanceId, instanceId),
          eq(taskRuns.targetType, 'host'),
          eq(taskRuns.targetId, hostId),
        ))

      // 14a. Terminal sessions (FK to hosts)
      await tx
        .delete(terminalSessions)
        .where(and(eq(terminalSessions.hostId, hostId), eq(terminalSessions.instanceId, instanceId)))

      // 14c. Host group memberships (FK to hosts)
      await tx
        .delete(hostGroupMembers)
        .where(eq(hostGroupMembers.hostId, hostId))

      // 14d. Host network memberships (FK to hosts)
      await tx
        .delete(hostNetworkMemberships)
        .where(and(
          eq(hostNetworkMemberships.hostId, hostId),
          eq(hostNetworkMemberships.instanceId, instanceId),
        ))

      // 15. Host itself
      await tx
        .delete(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId)))

      // 15. Agent status history + agent (host deletion revokes the agent so it
      //     can no longer connect; without this the agent keeps heartbeating
      //     against a host row that no longer exists)
      if (host.agentId) {
        // Capture the agent's client cert serial before we delete the row so
        // we can blacklist it — otherwise a deleted agent whose cert is still
        // inside its validity window could reconnect and register fresh.
        const agentRow = await tx.query.agents.findFirst({
          columns: { clientCertSerial: true },
          where: eq(agents.id, host.agentId),
        })
        if (agentRow?.clientCertSerial) {
          await tx
            .insert(revokedCertificates)
            .values({
              instanceId: instanceId,
              serial: agentRow.clientCertSerial,
              reason: 'Host deleted',
            })
            .onConflictDoNothing()
        }

        await tx
          .delete(pendingCertSignings)
          .where(eq(pendingCertSignings.agentId, host.agentId))
        await tx
          .delete(agentStatusHistory)
          .where(eq(agentStatusHistory.agentId, host.agentId))
        await tx
          .delete(agents)
          .where(eq(agents.id, host.agentId))
      }
    })

    if (hostNotFound) return { error: 'Host not found' }
    return { success: true }
  } catch (err) {
    logError('Failed to delete host:', err)
    return { error: 'An unexpected error occurred while deleting the host' }
  }
}

/**
 * Dispatches a remote agent uninstall task and, on success, removes the host
 * record using the existing deleteHost cascade.
 *
 * Flow:
 *  1. Verify the host exists and its agent is currently active — remote
 *     uninstall requires the agent to be connected so it can receive the task.
 *  2. Create a task_run of type 'agent_uninstall' targeting the host.
 *  3. Poll task_run_hosts.status until 'success' (agent has staged a detached
 *     uninstaller) or 'failed' / 'cancelled' / 'skipped' / timeout.
 *  4. On success: run the normal deleteHost cascade.
 *  5. On failure: return the taskRunId so the UI can offer the user a choice
 *     between retrying, viewing task history, or deleting the host record only.
 */
export async function uninstallAndDeleteHost(
  instanceId: string,
  hostId: string,
): Promise<
  | { success: true }
  | { error: string; taskRunId?: string; agentOffline?: boolean }
> {
  await requireInstanceAdminAccess(instanceId)
  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.instanceId, instanceId)),
    })
    if (!host) return { error: 'Host not found' }

    const agent = host.agentId
      ? await db.query.agents.findFirst({ where: eq(agents.id, host.agentId) })
      : null

    if (!agent || agent.status !== 'active') {
      return {
        error:
          'Agent is not currently connected — remote uninstall requires an active agent. Delete the host record only if you intend to leave the agent installed on the remote host.',
        agentOffline: true,
      }
    }

    const trigger = await triggerAgentUninstall(instanceId, hostId)
    if ('error' in trigger) return { error: trigger.error }

    // Poll until the agent reports the uninstall as scheduled, or we hit
    // the overall deadline. Agent typically returns success within a few
    // seconds because the handler returns as soon as it spawns the detached
    // uninstaller goroutine.
    const deadlineMs = Date.now() + 45_000
    let reachedSuccess = false
    while (Date.now() < deadlineMs) {
      const run = await getTaskRun(instanceId, trigger.taskRunId)
      const hostRun = run?.hosts[0]
      if (hostRun?.status === 'success') {
        reachedSuccess = true
        break
      }
      if (hostRun && ['failed', 'cancelled', 'skipped'].includes(hostRun.status)) {
        return {
          error: `Uninstall task did not complete (status: ${hostRun.status}). Host record was not deleted.`,
          taskRunId: trigger.taskRunId,
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }

    if (!reachedSuccess) {
      return {
        error:
          'Timed out waiting for the agent to acknowledge the uninstall task. Host record was not deleted.',
        taskRunId: trigger.taskRunId,
      }
    }

    return await deleteHost(instanceId, hostId)
  } catch (err) {
    logError('Failed to uninstall agent and delete host:', err)
    return { error: 'An unexpected error occurred while uninstalling the agent' }
  }
}
