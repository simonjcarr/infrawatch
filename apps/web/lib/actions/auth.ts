'use server'

import { logError } from '@/lib/logging'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { invitations, users } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import type { Invitation } from '@/lib/db/schema'
import { createRateLimiter } from '@/lib/rate-limit'
import { getPrimaryRole, normalizeAssignedRoles } from '@/lib/auth/roles'

// 10 invite-token lookups per IP per 60 s — prevents token enumeration
const inviteRateLimit = createRateLimiter({
  scope: 'auth:invite',
  windowMs: 60_000,
  max: 10,
})

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
}

export async function getInviteByToken(token: string): Promise<Invitation | null> {
  const ip = await getClientIp()
  if (!await inviteRateLimit.check(ip)) return null

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
  if (!await inviteRateLimit.check(ip)) {
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

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    if (!user) {
      return { error: 'Account not found' }
    }

    if (user.organisationId) {
      return { error: 'This account already belongs to an organisation' }
    }

    if (!user.emailVerified) {
      return { error: 'Verify your email before accepting this invitation' }
    }

    if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
      return { error: 'This invitation was sent to a different email address' }
    }

    const inviteRoles = normalizeAssignedRoles(invite.roles, invite.role)
    const inviteRole = getPrimaryRole(inviteRoles, invite.role)

    await db
      .update(users)
      .set({
        organisationId: invite.organisationId,
        role: inviteRole,
        roles: inviteRoles,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    await db
      .update(invitations)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(invitations.id, invite.id))

    return { success: true }
  } catch (err) {
    logError('Failed to accept invite:', err)
    return { error: 'An unexpected error occurred' }
  }
}
