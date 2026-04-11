'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import {
  agents,
  agentStatusHistory,
  agentEnrolmentTokens,
  hosts,
  hostMetrics,
  checks,
  checkResults,
  alertRules,
  alertInstances,
  alertSilences,
  certificates,
  certificateEvents,
  serviceAccounts,
  sshKeys,
  identityEvents,
  agentQueries,
  resourceTags,
} from '@/lib/db/schema'
import { eq, and, isNull, isNotNull, gt, gte, asc, sql, inArray } from 'drizzle-orm'
import type { Agent, AgentEnrolmentToken, Host, HostMetric } from '@/lib/db/schema'
import { applyGlobalDefaultsToHost } from '@/lib/actions/alerts'
import { getOrgDefaultCollectionSettings } from '@/lib/actions/host-settings'
import type { HostMetadata } from '@/lib/db/schema'

export type OfflinePeriod = { start: number; end: number | null }

const createEnrolmentTokenSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100),
  autoApprove: z.boolean().default(false),
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
  input: { label: string; autoApprove: boolean; maxUses?: number; expiresInDays?: number },
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
  const tokens = await db.query.agentEnrolmentTokens.findMany({
    where: and(
      eq(agentEnrolmentTokens.organisationId, orgId),
      isNull(agentEnrolmentTokens.deletedAt),
    ),
  })

  if (tokens.length === 0) return tokens

  // Derive live usage count from active agents — the stored counter can drift
  // if hosts are deleted, so we always compute it fresh
  const liveCounts = await db
    .select({
      enrolmentTokenId: agents.enrolmentTokenId,
      count: sql<number>`count(*)::int`,
    })
    .from(agents)
    .where(
      and(
        eq(agents.organisationId, orgId),
        isNull(agents.deletedAt),
        isNotNull(agents.enrolmentTokenId),
        inArray(agents.enrolmentTokenId, tokens.map((t) => t.id)),
      ),
    )
    .groupBy(agents.enrolmentTokenId)

  const countMap = new Map(liveCounts.map((r) => [r.enrolmentTokenId, r.count]))

  return tokens.map((token) => ({
    ...token,
    usageCount: countMap.get(token.id) ?? 0,
  }))
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

export type MetricsRange = '1h' | '24h' | '7d'

export async function getHostMetrics(
  orgId: string,
  hostId: string,
  range: MetricsRange,
): Promise<HostMetric[]> {
  const hours = range === '1h' ? 1 : range === '24h' ? 24 : 168
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
  // db.execute() does not serialise Date parameters — use ISO string instead
  const cutoffISO = cutoff.toISOString()

  // For 7d and 24h ranges, try to use the continuous aggregate views (TimescaleDB).
  // Falls back to raw table on plain PostgreSQL or if the view doesn't exist yet.
  if (range === '7d' || range === '24h') {
    const view = range === '7d' ? 'host_metrics_daily' : 'host_metrics_hourly'
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
          AND bucket         >= ${cutoffISO}
        ORDER BY bucket ASC
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
      // Aggregate view not available — fall through to raw query
    }
  }

  return db
    .select()
    .from(hostMetrics)
    .where(
      and(
        eq(hostMetrics.organisationId, orgId),
        eq(hostMetrics.hostId, hostId),
        gte(hostMetrics.recordedAt, cutoff),
      ),
    )
    .orderBy(asc(hostMetrics.recordedAt))
}

export async function getAgentOfflinePeriods(
  orgId: string,
  agentId: string,
  range: MetricsRange,
): Promise<OfflinePeriod[]> {
  const hours = range === '1h' ? 1 : range === '24h' ? 24 : 168
  const windowStart = Date.now() - hours * 60 * 60 * 1000
  // Look back one extra hour before the window to capture an offline event that
  // started before the visible range.
  const lookback = new Date(windowStart - 60 * 60 * 1000)

  const events = await db
    .select({ status: agentStatusHistory.status, createdAt: agentStatusHistory.createdAt })
    .from(agentStatusHistory)
    .where(
      and(
        eq(agentStatusHistory.agentId, agentId),
        eq(agentStatusHistory.organisationId, orgId),
        gte(agentStatusHistory.createdAt, lookback),
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

  // Agent is still offline — period extends to now
  if (offlineStart !== null) {
    periods.push({ start: offlineStart, end: null })
  }

  return periods
}

export type HeartbeatPoint = { time: number; intervalSecs: number }

export async function getHeartbeatHistory(
  orgId: string,
  hostId: string,
  range: MetricsRange,
): Promise<HeartbeatPoint[]> {
  const hours = range === '1h' ? 1 : range === '24h' ? 24 : 168
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
  // db.execute() does not serialise Date parameters — use ISO string instead
  const cutoffISO = cutoff.toISOString()

  if (range === '1h') {
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
        AND recorded_at    >= ${cutoffISO}
      ORDER BY recorded_at ASC
    `)
    return Array.from(rows)
      .filter((r) => r.interval_secs != null)
      .map((r) => ({
        time: new Date(r.recorded_at).getTime(),
        intervalSecs: parseFloat(Number(r.interval_secs).toFixed(1)),
      }))
  }

  // 24h/7d: bucket by 5-minute or 1-hour windows and take the MAX gap per
  // bucket so outages are visible even when there are many healthy heartbeats
  // in the same window. Uses TimescaleDB time_bucket; falls back to raw LAG
  // on plain PostgreSQL.
  const bucketInterval = range === '24h' ? sql.raw("'5 minutes'") : sql.raw("'1 hour'")
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
          AND recorded_at    >= ${cutoffISO}
      )
      SELECT
        time_bucket(${bucketInterval}::interval, recorded_at) AS bucket,
        MAX(interval_secs)                                     AS max_interval_secs
      FROM intervals
      WHERE interval_secs IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
    `)
    return Array.from(rows)
      .filter((r) => r.max_interval_secs != null)
      .map((r) => ({
        time: new Date(r.bucket).getTime(),
        intervalSecs: parseFloat(Number(r.max_interval_secs).toFixed(1)),
      }))
  } catch {
    // Plain PostgreSQL fallback — raw intervals, capped to avoid massive payloads
    const rows = await db.execute<{ recorded_at: string; interval_secs: number | null }>(sql`
      SELECT
        recorded_at,
        EXTRACT(EPOCH FROM (
          recorded_at - LAG(recorded_at) OVER (ORDER BY recorded_at)
        ))::float AS interval_secs
      FROM host_metrics
      WHERE organisation_id = ${orgId}
        AND host_id         = ${hostId}
        AND recorded_at    >= ${cutoffISO}
      ORDER BY recorded_at ASC
      LIMIT 500
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

      // 7. Alert instances
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

      // 14. Host itself
      await tx
        .delete(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)))

      // 15. Agent status history + agent (host deletion revokes the agent so it
      //     can no longer connect; without this the agent keeps heartbeating
      //     against a host row that no longer exists)
      if (host.agentId) {
        // Fetch the enrolment token ID before deleting the agent so we can
        // decrement the usage counter — keeping it in sync with live registrations
        const agent = await tx.query.agents.findFirst({
          where: eq(agents.id, host.agentId),
          columns: { enrolmentTokenId: true },
        })

        if (agent?.enrolmentTokenId) {
          await tx
            .update(agentEnrolmentTokens)
            .set({
              usageCount: sql`GREATEST(usage_count - 1, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(agentEnrolmentTokens.id, agent.enrolmentTokenId))
        }

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
