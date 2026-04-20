'use server'

import { z } from 'zod'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import {
  supportAiJobs,
  supportMessages,
  supportSettings,
  supportTickets,
  users,
} from '@/lib/db/schema'
import { getRequiredSession } from '@/lib/auth/session'
import { assertSuperAdmin } from '@/lib/auth/require-super-admin'
import { env } from '@/lib/env'
import { redactCustomerText } from '@/lib/support/ai/redact'
import type {
  SupportMessage,
  SupportMessageAuthor,
  SupportTicket,
} from '@/lib/db/schema'

// Effective AI state = env kill switch OFF && settings row enabled.
export async function isSupportAiEnabled(): Promise<boolean> {
  if (env.supportAiKillSwitch) return false
  const row = await db.query.supportSettings.findFirst({
    where: eq(supportSettings.id, 'singleton'),
  })
  if (!row) return true
  return row.aiEnabled
}

async function ensureSettingsRow(): Promise<void> {
  await db
    .insert(supportSettings)
    .values({ id: 'singleton', aiEnabled: true })
    .onConflictDoNothing({ target: supportSettings.id })
}

async function enqueueAiJob(ticketId: string): Promise<void> {
  await db.insert(supportAiJobs).values({ ticketId, status: 'queued' })
}

const createTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(1).max(20_000),
})

export async function createTicket(input: unknown): Promise<{ id: string }> {
  const { user } = await getRequiredSession()
  if (!user.organisationId) throw new Error('Account has no organisation yet')
  const data = createTicketSchema.parse(input)

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      organisationId: user.organisationId,
      createdByUserId: user.id,
      subject: data.subject,
      status: 'open',
    })
    .returning({ id: supportTickets.id })
  if (!ticket) throw new Error('Failed to create ticket')

  await db.insert(supportMessages).values({
    ticketId: ticket.id,
    author: 'customer' as SupportMessageAuthor,
    authorUserId: user.id,
    body: data.body,
    bodyRedacted: redactCustomerText(data.body),
  })

  if (await isSupportAiEnabled()) {
    await enqueueAiJob(ticket.id)
  }
  revalidatePath('/support')
  return { id: ticket.id }
}

const postMessageSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().min(1).max(20_000),
})

export async function postCustomerMessage(input: unknown): Promise<void> {
  const { user } = await getRequiredSession()
  if (!user.organisationId) throw new Error('Account has no organisation yet')
  const data = postMessageSchema.parse(input)

  const ticket = await db.query.supportTickets.findFirst({
    where: and(
      eq(supportTickets.id, data.ticketId),
      eq(supportTickets.organisationId, user.organisationId),
    ),
  })
  if (!ticket) throw new Error('Ticket not found')
  if (ticket.status === 'closed') throw new Error('Ticket is closed')

  const now = new Date()
  await db.insert(supportMessages).values({
    ticketId: ticket.id,
    author: 'customer',
    authorUserId: user.id,
    body: data.body,
    bodyRedacted: redactCustomerText(data.body),
  })
  await db
    .update(supportTickets)
    .set({ lastMessageAt: now, status: 'open', updatedAt: now })
    .where(eq(supportTickets.id, ticket.id))

  if (!ticket.aiPaused && (await isSupportAiEnabled())) {
    await enqueueAiJob(ticket.id)
  }
  revalidatePath(`/support/${ticket.id}`)
}

export async function postStaffMessage(input: unknown): Promise<void> {
  const { user } = await assertSuperAdmin()
  const data = postMessageSchema.parse(input)

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, data.ticketId),
  })
  if (!ticket) throw new Error('Ticket not found')

  const now = new Date()
  await db.insert(supportMessages).values({
    ticketId: ticket.id,
    author: 'staff',
    authorUserId: user.id,
    body: data.body,
  })
  // Staff reply auto-pauses AI: humans have taken over.
  await db
    .update(supportTickets)
    .set({
      aiPaused: true,
      lastMessageAt: now,
      status: 'pending_customer',
      updatedAt: now,
    })
    .where(eq(supportTickets.id, ticket.id))
  revalidatePath(`/admin/support/${ticket.id}`)
  revalidatePath(`/support/${ticket.id}`)
}

const setPausedSchema = z.object({
  ticketId: z.string().min(1),
  paused: z.boolean(),
})

export async function setAiPaused(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const data = setPausedSchema.parse(input)
  await db
    .update(supportTickets)
    .set({ aiPaused: data.paused, updatedAt: new Date() })
    .where(eq(supportTickets.id, data.ticketId))
  revalidatePath(`/admin/support/${data.ticketId}`)
}

const setGlobalSchema = z.object({ enabled: z.boolean() })

export async function setGlobalAiEnabled(input: unknown): Promise<void> {
  const { user } = await assertSuperAdmin()
  const data = setGlobalSchema.parse(input)
  await ensureSettingsRow()
  await db
    .update(supportSettings)
    .set({ aiEnabled: data.enabled, updatedByUserId: user.id, updatedAt: new Date() })
    .where(eq(supportSettings.id, 'singleton'))
  revalidatePath('/admin/support/settings')
}

const statusSchema = z.object({
  ticketId: z.string().min(1),
  status: z.enum(['open', 'pending_customer', 'pending_staff', 'resolved', 'closed']),
})

export async function setTicketStatus(input: unknown): Promise<void> {
  await assertSuperAdmin()
  const data = statusSchema.parse(input)
  await db
    .update(supportTickets)
    .set({ status: data.status, updatedAt: new Date() })
    .where(eq(supportTickets.id, data.ticketId))
  revalidatePath(`/admin/support/${data.ticketId}`)
}

// ── Read paths ────────────────────────────────────────────────────────────

export async function listMyTickets(): Promise<SupportTicket[]> {
  const { user } = await getRequiredSession()
  if (!user.organisationId) return []
  return db.query.supportTickets.findMany({
    where: eq(supportTickets.organisationId, user.organisationId),
    orderBy: [desc(supportTickets.lastMessageAt)],
  })
}

export async function getMyTicket(
  id: string,
): Promise<{ ticket: SupportTicket; messages: SupportMessage[] } | null> {
  const { user } = await getRequiredSession()
  if (!user.organisationId) return null
  const ticket = await db.query.supportTickets.findFirst({
    where: and(
      eq(supportTickets.id, id),
      eq(supportTickets.organisationId, user.organisationId),
    ),
  })
  if (!ticket) return null
  const messages = await db.query.supportMessages.findMany({
    where: eq(supportMessages.ticketId, ticket.id),
    orderBy: [supportMessages.createdAt],
  })
  return { ticket, messages }
}

export async function listAllTicketsForAdmin(): Promise<SupportTicket[]> {
  await assertSuperAdmin()
  return db.query.supportTickets.findMany({
    orderBy: [desc(supportTickets.lastMessageAt)],
  })
}

export type SupportHealth = {
  unansweredCount: number
  flaggedCount: number
  flagged: Array<{ id: string; subject: string; flagReason: string | null }>
}

// Summary counts used by the admin health banner. Super-admin only.
// - unanswered: tickets awaiting a staff response (pending_staff, not closed/resolved).
// - flagged: tickets paused because of an AI tool error or injection flag.
export async function getSupportHealth(): Promise<SupportHealth> {
  await assertSuperAdmin()

  const unansweredRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.status, 'pending_staff'),
      ),
    )
  const unansweredCount = unansweredRows[0]?.count ?? 0

  const flaggedTickets = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      flagReason: supportTickets.aiFlagReason,
    })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.aiPaused, true),
        isNotNull(supportTickets.aiFlagReason),
        inArray(supportTickets.status, ['open', 'pending_customer', 'pending_staff']),
      ),
    )
    .orderBy(desc(supportTickets.updatedAt))
    .limit(10)

  return {
    unansweredCount,
    flaggedCount: flaggedTickets.length,
    flagged: flaggedTickets,
  }
}

export async function getAdminTicket(id: string): Promise<{
  ticket: SupportTicket
  messages: (SupportMessage & { authorName: string | null })[]
  orgName: string | null
} | null> {
  await assertSuperAdmin()
  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  })
  if (!ticket) return null
  const msgs = await db.query.supportMessages.findMany({
    where: eq(supportMessages.ticketId, ticket.id),
    orderBy: [supportMessages.createdAt],
  })
  const userIds = Array.from(new Set(msgs.map((m) => m.authorUserId).filter(Boolean))) as string[]
  const nameRows =
    userIds.length === 0
      ? []
      : await db.select({ id: users.id, name: users.name }).from(users)
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]))
  const messages = msgs.map((m) => ({
    ...m,
    authorName: m.authorUserId ? nameById.get(m.authorUserId) ?? null : null,
  }))
  const orgRow = await db.query.organisations.findFirst({
    where: (t, { eq: eqFn }) => eqFn(t.id, ticket.organisationId),
  })
  return { ticket, messages, orgName: orgRow?.name ?? null }
}
