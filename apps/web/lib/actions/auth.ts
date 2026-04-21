'use server'

import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { invitations, users } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import type { Invitation } from '@/lib/db/schema'
import { createRateLimiter } from '@/lib/rate-limit'

// 10 invite-token lookups per IP per 60 s — prevents token enumeration
const inviteRateLimit = createRateLimiter(60_000, 10)

async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
}

export async function getInviteByToken(token: string): Promise<Invitation | null> {
  const ip = await getClientIp()
  if (!inviteRateLimit.check(ip)) return null

  const invite = await db.query.invitations.findFirst({
    where: and(
      eq(invitations.token, token),
      isNull(invitations.deletedAt),
      isNull(invitations.acceptedAt),
      gt(invitations.expiresAt, new Date()),
    ),
  })
  return invite ?? null
}

export async function acceptInvite(
  token: string,
  userId: string,
): Promise<{ success: true } | { error: string }> {
  const ip = await getClientIp()
  if (!inviteRateLimit.check(ip)) {
    return { error: 'Too many requests — please wait before trying again.' }
  }

  try {
    const invite = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.token, token),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    })

    if (!invite) {
      return { error: 'Invitation not found or has expired' }
    }

    await db
      .update(users)
      .set({
        organisationId: invite.organisationId,
        role: invite.role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    await db
      .update(invitations)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(invitations.id, invite.id))

    return { success: true }
  } catch (err) {
    console.error('Failed to accept invite:', err)
    return { error: 'An unexpected error occurred' }
  }
}
