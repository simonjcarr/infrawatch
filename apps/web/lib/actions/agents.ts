'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { agents, agentStatusHistory, agentEnrolmentTokens, hosts } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import type { Agent, AgentEnrolmentToken, Host } from '@/lib/db/schema'

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
