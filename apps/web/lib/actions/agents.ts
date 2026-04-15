'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import {
  agents,
  agentStatusHistory,
  agentEnrolmentTokens,
  hosts,
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
} from '@/lib/db/schema'
import { eq, and, isNull, gt, gte, lte, asc, sql, inArray } from 'drizzle-orm'
import type { Agent, AgentEnrolmentToken, Host, HostMetric } from '@/lib/db/schema'
import { applyGlobalDefaultsToHost } from '@/lib/actions/alerts'
import { getOrgDefaultCollectionSettings } from '@/lib/actions/host-settings'
import { triggerAgentUninstall, getTaskRun } from '@/lib/actions/task-runs'
import type { HostMetadata } from '@/lib/db/schema'

export type OfflinePeriod = { start: number; end: number | null }

const createEnrolmentTokenSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100),
  autoApprove: z.boolean().default(false),
  skipVerify: z.boolean().default(false),
  maxUses: z.number().int().positive().optional(),
  expiresInDays: z.number().int().positive().optional(),
})

export async function listPendingAgents(orgId: string): Promise<Agent[]> {
  return db.query.agents.findMany({
    where: and(
      eq(agents.organisationId, orgId),
      eq(agents.status, 'pending'),
      isNull(agents.deletedAt),
    ),
  })
}

export async function approveAgent(
  orgId: string,
  agentId: string,
  actorId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), eq(agents.organisationId, orgId)),
    })
    if (!agent) return { error: 'Agent not found' }
    if (agent.status !== 'pending') return { error: 'Agent is not in pending state' }

    await db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({
          status: 'active',
          approvedById: actorId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)))

      await tx.insert(agentStatusHistory).values({
        agentId,
        organisationId: orgId,
        status: 'active',
        actorId,
        reason: 'Approved by admin',
      })
    })

    // Apply defaults to the associated host (best-effort, outside transaction)
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.agentId, agentId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
    })
    if (host) {
      await applyGlobalDefaultsToHost(orgId, host.id)

      // Apply org default collection settings to the new host
      const defaults = await getOrgDefaultCollectionSettings(orgId)
      const currentMetadata = (host.metadata ?? { disks: [], network_interfaces: [] }) as HostMetadata
      await db
        .update(hosts)
        .set({
          metadata: { ...currentMetadata, collectionSettings: defaults },
          updatedAt: new Date(),
        })
        .where(and(eq(hosts.id, host.id), eq(hosts.organisationId, orgId)))
    }

    return { success: true }
  } catch (err) {
    console.error('Failed to approve agent:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function rejectAgent(
  orgId: string,
  agentId: string,
  actorId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), eq(agents.organisationId, orgId)),
    })
    if (!agent) return { error: 'Agent not found' }

    await db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)))

      await tx.insert(agentStatusHistory).values({
        agentId,
        organisationId: orgId,
        status: 'revoked',
        actorId,
        reason: 'Rejected by admin',
      })
    })

    return { success: true }
  } catch (err) {
    console.error('Failed to reject agent:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export type HostWithAgent = Host & { agent: Agent | null }

export async function listHosts(orgId: string): Promise<HostWithAgent[]> {
  const rows = await db
    .select()
    .from(hosts)
    .leftJoin(agents, eq(hosts.agentId, agents.id))
    .where(and(eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)))

  return rows.map((row) => ({
    ...row.hosts,
    agent: row.agents ?? null,
  }))
}

export async function createEnrolmentToken(
  orgId: string,
  userId: string,
  input: { label: string; autoApprove: boolean; skipVerify?: boolean; maxUses?: number; expiresInDays?: number },
): Promise<{ token: string; id: string } | { error: string }> {
  const parsed = createEnrolmentTokenSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    let expiresAt: Date | undefined
    if (parsed.data.expiresInDays) {
      expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + parsed.data.expiresInDays)
    }

    const [record] = await db
      .insert(agentEnrolmentTokens)
      .values({
        organisationId: orgId,
        label: parsed.data.label,
        createdById: userId,
        autoApprove: parsed.data.autoApprove,
        skipVerify: parsed.data.skipVerify,
        maxUses: parsed.data.maxUses ?? null,
        expiresAt: expiresAt ?? null,
      })
      .returning()

    if (!record) return { error: 'Failed to create enrolment token' }

    return { token: record.token, id: record.id }
  } catch (err) {
    console.error('Failed to create enrolment token:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function listEnrolmentTokens(orgId: string): Promise<AgentEnrolmentToken[]> {
  return db.query.agentEnrolmentTokens.findMany({
    where: and(
      eq(agentEnrolmentTokens.organisationId, orgId),
      isNull(agentEnrolmentTokens.deletedAt),
    ),
  })
}

export async function revokeEnrolmentToken(
  orgId: string,
  tokenId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await db
      .update(agentEnrolmentTokens)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(agentEnrolmentTokens.id, tokenId), eq(agentEnrolmentTokens.organisationId, orgId)),
      )

    return { success: true }
  } catch (err) {
    console.error('Failed to revoke enrolment token:', err)
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
  orgId: string,
  hostId: string,
  query: MetricsQuery,
): Promise<HostMetric[]> {
  const { from, to, fromISO, toISO } = resolveTimeBounds(query)
  const bucketMode = computeBucketMode(to.getTime() - from.getTime())

  if (bucketMode.kind === 'bucket') {
    // Continuous aggregate path — fast pre-computed 1h or 1d buckets
    if (bucketMode.useAggregate != null) {
      const view = bucketMode.useAggregate === 'daily' ? 'host_metrics_daily' : 'host_metrics_hourly'
      try {
        const rows = await db.execute<{
          id: string
          organisation_id: string
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
            ${orgId}                             AS organisation_id,
            ${hostId}                            AS host_id,
            bucket                               AS recorded_at,
            cpu_percent,
            memory_percent,
            disk_percent,
            NULL::integer                        AS uptime_seconds,
            bucket                               AS created_at
          FROM ${sql.identifier(view)}
          WHERE organisation_id = ${orgId}
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
            organisationId: r.organisation_id,
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
        WHERE organisation_id = ${orgId}
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
          organisationId: orgId,
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
  return db
    .select()
    .from(hostMetrics)
    .where(
      and(
        eq(hostMetrics.organisationId, orgId),
        eq(hostMetrics.hostId, hostId),
        gte(hostMetrics.recordedAt, from),
        lte(hostMetrics.recordedAt, to),
      ),
    )
    .orderBy(asc(hostMetrics.recordedAt))
    .limit(MAX_DATA_POINTS)
}

export async function getAgentOfflinePeriods(
  orgId: string,
  agentId: string,
  query: MetricsQuery,
): Promise<OfflinePeriod[]> {
  const { from, to } = resolveTimeBounds(query)
  const windowStart = from.getTime()
  // Look back one extra hour before the window to capture an offline event that
  // started before the visible range.
  const lookback = new Date(from.getTime() - 3_600_000)

  const events = await db
    .select({ status: agentStatusHistory.status, createdAt: agentStatusHistory.createdAt })
    .from(agentStatusHistory)
    .where(
      and(
        eq(agentStatusHistory.agentId, agentId),
        eq(agentStatusHistory.organisationId, orgId),
        gte(agentStatusHistory.createdAt, lookback),
        lte(agentStatusHistory.createdAt, to),
      ),
    )
    .orderBy(asc(agentStatusHistory.createdAt))

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
  orgId: string,
  hostId: string,
  query: MetricsQuery,
): Promise<HeartbeatPoint[]> {
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
      WHERE organisation_id = ${orgId}
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
        WHERE organisation_id = ${orgId}
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
      WHERE organisation_id = ${orgId}
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

export async function getHost(orgId: string, hostId: string): Promise<HostWithAgent | null> {
  const rows = await db
    .select()
    .from(hosts)
    .leftJoin(agents, eq(hosts.agentId, agents.id))
    .where(
      and(
        eq(hosts.id, hostId),
        eq(hosts.organisationId, orgId),
        isNull(hosts.deletedAt),
      ),
    )
    .limit(1)

  if (rows.length === 0) return null
  const row = rows[0]!
  return {
    ...row.hosts,
    agent: row.agents ?? null,
  }
}

export async function deleteHost(
  orgId: string,
  hostId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)),
    })
    if (!host) return { error: 'Host not found' }

    await db.transaction(async (tx) => {
      // 1. Identity events (references service_account_id, ssh_key_id, host_id)
      await tx
        .delete(identityEvents)
        .where(and(eq(identityEvents.hostId, hostId), eq(identityEvents.organisationId, orgId)))

      // 2. SSH keys (references host_id, service_account_id)
      await tx
        .delete(sshKeys)
        .where(and(eq(sshKeys.hostId, hostId), eq(sshKeys.organisationId, orgId)))

      // 3. Service accounts
      await tx
        .delete(serviceAccounts)
        .where(and(eq(serviceAccounts.hostId, hostId), eq(serviceAccounts.organisationId, orgId)))

      // 4. Check results (references check_id which references host_id)
      await tx
        .delete(checkResults)
        .where(and(eq(checkResults.hostId, hostId), eq(checkResults.organisationId, orgId)))

      // 5. Certificate events & certificates (certificates reference both
      //    discovered_by_host_id AND check_id, so must be deleted before checks)
      const hostCheckIds = (
        await tx
          .select({ id: checks.id })
          .from(checks)
          .where(and(eq(checks.hostId, hostId), eq(checks.organisationId, orgId)))
      ).map((c) => c.id)

      const hostCerts = await tx
        .select({ id: certificates.id })
        .from(certificates)
        .where(and(
          eq(certificates.organisationId, orgId),
          sql`(${certificates.discoveredByHostId} = ${hostId}${
            hostCheckIds.length > 0
              ? sql` OR ${certificates.checkId} IN (${sql.join(hostCheckIds.map((id) => sql`${id}`), sql`, `)})`
              : sql``
          })`,
        ))

      if (hostCerts.length > 0) {
        const certIds = hostCerts.map((c) => c.id)
        await tx
          .delete(certificateEvents)
          .where(and(
            inArray(certificateEvents.certificateId, certIds),
            eq(certificateEvents.organisationId, orgId),
          ))
        await tx
          .delete(certificates)
          .where(and(
            inArray(certificates.id, certIds),
            eq(certificates.organisationId, orgId),
          ))
      }

      // 6. Checks (host-specific only — now safe, certificates removed above)
      await tx
        .delete(checks)
        .where(and(eq(checks.hostId, hostId), eq(checks.organisationId, orgId)))

      // 7a. Notifications referencing this host's alert instances (FK constraint)
      await tx
        .delete(notifications)
        .where(and(
          inArray(
            notifications.alertInstanceId,
            tx
              .select({ id: alertInstances.id })
              .from(alertInstances)
              .where(and(eq(alertInstances.hostId, hostId), eq(alertInstances.organisationId, orgId))),
          ),
        ))

      // 7b. Alert instances
      await tx
        .delete(alertInstances)
        .where(and(eq(alertInstances.hostId, hostId), eq(alertInstances.organisationId, orgId)))

      // 8. Alert silences (host-specific only)
      await tx
        .delete(alertSilences)
        .where(and(eq(alertSilences.hostId, hostId), eq(alertSilences.organisationId, orgId)))

      // 9. Alert rules (host-specific only)
      await tx
        .delete(alertRules)
        .where(and(eq(alertRules.hostId, hostId), eq(alertRules.organisationId, orgId)))

      // 11. Agent queries
      await tx
        .delete(agentQueries)
        .where(and(eq(agentQueries.hostId, hostId), eq(agentQueries.organisationId, orgId)))

      // 12. Host metrics
      await tx
        .delete(hostMetrics)
        .where(and(eq(hostMetrics.hostId, hostId), eq(hostMetrics.organisationId, orgId)))

      // 13. Resource tags
      await tx
        .delete(resourceTags)
        .where(and(
          eq(resourceTags.resourceId, hostId),
          eq(resourceTags.resourceType, 'host'),
          eq(resourceTags.organisationId, orgId),
        ))

      // 13a. Task run host rows (FK to hosts; must be removed before the host
      //      is deleted or the transaction fails). Group-targeted task_runs
      //      keep their rows for other hosts; host-targeted task_runs are
      //      then removed as orphans below since they have no remaining rows.
      await tx
        .delete(taskRunHosts)
        .where(and(
          eq(taskRunHosts.hostId, hostId),
          eq(taskRunHosts.organisationId, orgId),
        ))
      await tx
        .delete(taskRuns)
        .where(and(
          eq(taskRuns.organisationId, orgId),
          eq(taskRuns.targetType, 'host'),
          eq(taskRuns.targetId, hostId),
        ))

      // 14a. Terminal sessions (FK to hosts)
      await tx
        .delete(terminalSessions)
        .where(and(eq(terminalSessions.hostId, hostId), eq(terminalSessions.organisationId, orgId)))

      // 14b. Software scans + packages (FK to hosts)
      await tx
        .delete(softwarePackages)
        .where(and(eq(softwarePackages.hostId, hostId), eq(softwarePackages.organisationId, orgId)))
      await tx
        .delete(softwareScans)
        .where(and(eq(softwareScans.hostId, hostId), eq(softwareScans.organisationId, orgId)))

      // 14c. Host group memberships (FK to hosts)
      await tx
        .delete(hostGroupMembers)
        .where(eq(hostGroupMembers.hostId, hostId))

      // 15. Host itself
      await tx
        .delete(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)))

      // 15. Agent status history + agent (host deletion revokes the agent so it
      //     can no longer connect; without this the agent keeps heartbeating
      //     against a host row that no longer exists)
      if (host.agentId) {
        await tx
          .delete(agentStatusHistory)
          .where(eq(agentStatusHistory.agentId, host.agentId))
        await tx
          .delete(agents)
          .where(eq(agents.id, host.agentId))
      }
    })

    return { success: true }
  } catch (err) {
    console.error('Failed to delete host:', err)
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
  orgId: string,
  userId: string,
  hostId: string,
): Promise<
  | { success: true }
  | { error: string; taskRunId?: string; agentOffline?: boolean }
> {
  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)),
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

    const trigger = await triggerAgentUninstall(orgId, userId, hostId)
    if ('error' in trigger) return { error: trigger.error }

    // Poll until the agent reports the uninstall as scheduled, or we hit
    // the overall deadline. Agent typically returns success within a few
    // seconds because the handler returns as soon as it spawns the detached
    // uninstaller goroutine.
    const deadlineMs = Date.now() + 45_000
    let reachedSuccess = false
    while (Date.now() < deadlineMs) {
      const run = await getTaskRun(orgId, trigger.taskRunId)
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

    return await deleteHost(orgId, hostId)
  } catch (err) {
    console.error('Failed to uninstall agent and delete host:', err)
    return { error: 'An unexpected error occurred while uninstalling the agent' }
  }
}
