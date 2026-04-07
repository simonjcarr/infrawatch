'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { agents, agentStatusHistory, agentEnrolmentTokens, hosts, hostMetrics } from '@/lib/db/schema'
import { eq, and, isNull, gt, gte, asc } from 'drizzle-orm'
import type { Agent, AgentEnrolmentToken, Host, HostMetric } from '@/lib/db/schema'
import { applyGlobalDefaultsToHost } from '@/lib/actions/alerts'

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

    // Apply global alert defaults to the associated host (best-effort, outside transaction)
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.agentId, agentId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
    })
    if (host) {
      await applyGlobalDefaultsToHost(orgId, host.id)
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

export type MetricsRange = '1h' | '24h' | '7d'

export async function getHostMetrics(
  orgId: string,
  hostId: string,
  range: MetricsRange,
): Promise<HostMetric[]> {
  const hours = range === '1h' ? 1 : range === '24h' ? 24 : 168
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

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
