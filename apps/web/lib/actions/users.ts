'use server'

import { logError } from '@/lib/logging'
import { requireOrgAccess, requireOrgAdminAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { users, invitations, sessions } from '@/lib/db/schema'
import { eq, and, isNull, isNotNull, gt } from 'drizzle-orm'
import type { User, Invitation } from '@/lib/db/schema'
import { getBetterAuthOrigin } from '@/lib/auth/env'
import { writeAuditEvent } from '@/lib/audit/events'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['org_admin', 'engineer', 'read_only']),
})

const updateRoleSchema = z.object({
  role: z.enum(['super_admin', 'org_admin', 'engineer', 'read_only']),
})

export async function getOrgUsers(
  orgId: string,
): Promise<{ members: User[]; pendingInvites: Invitation[] }> {
  await requireOrgAccess(orgId)

  const [members, pendingInvites] = await Promise.all([
    db.query.users.findMany({
      where: and(eq(users.organisationId, orgId), isNull(users.deletedAt)),
    }),
    db.query.invitations.findMany({
      where: and(
        eq(invitations.organisationId, orgId),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    }),
  ])
  return { members, pendingInvites }
}

export async function inviteUser(
  orgId: string,
  input: { email: string; role: string },
): Promise<{ inviteLink: string } | { restored: true } | { error: string }> {
  await requireOrgAccess(orgId)
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    const session = await requireOrgAdminAccess(orgId)

    // Check for a previously removed user — restore them rather than re-registering,
    // since their account (and email) still exist in the database.
    const removedUser = await db.query.users.findFirst({
      where: and(
        eq(users.email, parsed.data.email),
        eq(users.organisationId, orgId),
        isNotNull(users.deletedAt),
      ),
    })
    if (removedUser) {
      await db
        .update(users)
        .set({ deletedAt: null, isActive: true, role: parsed.data.role, updatedAt: new Date() })
        .where(eq(users.id, removedUser.id))
      return { restored: true }
    }

    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.email, parsed.data.email),
        eq(users.organisationId, orgId),
        isNull(users.deletedAt),
      ),
    })
    if (existing) {
      return { error: 'This user is already a member of your organisation' }
    }

    const existingInvite = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.email, parsed.data.email),
        eq(invitations.organisationId, orgId),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    })
    if (existingInvite) {
      return { error: 'An invitation has already been sent to this email address' }
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const [invite] = await db
      .insert(invitations)
      .values({
        email: parsed.data.email,
        role: parsed.data.role,
        organisationId: orgId,
        invitedById: session.user.id,
        expiresAt,
      })
      .returning()

    if (!invite) return { error: 'Failed to create invitation' }

    const baseUrl = getBetterAuthOrigin()
    return { inviteLink: `${baseUrl}/register?invite=${invite.token}` }
  } catch (err) {
    logError('Failed to invite user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateUserRole(
  orgId: string,
  targetUserId: string,
  role: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  const parsed = updateRoleSchema.safeParse({ role })
  if (!parsed.success) {
    return { error: 'Invalid role' }
  }

  try {
    const session = await requireOrgAdminAccess(orgId)
    const targetUser = await db.query.users.findFirst({
      where: and(eq(users.id, targetUserId), eq(users.organisationId, orgId)),
      columns: { id: true, email: true, role: true },
    })
    if (!targetUser) {
      return { error: 'User not found' }
    }

    if (parsed.data.role !== 'super_admin') {
      const superAdmins = await db.query.users.findMany({
        where: and(
          eq(users.organisationId, orgId),
          eq(users.role, 'super_admin'),
        ),
      })
      const isTarget = superAdmins.some((u) => u.id === targetUserId)
      if (isTarget && superAdmins.length === 1) {
        return { error: 'Cannot demote the last super admin' }
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ role: parsed.data.role, updatedAt: new Date() })
        .where(and(eq(users.id, targetUserId), eq(users.organisationId, orgId)))

      await writeAuditEvent(tx, {
        organisationId: orgId,
        actorUserId: session.user.id,
        action: 'user.role.updated',
        targetType: 'user',
        targetId: targetUser.id,
        summary: `Changed ${targetUser.email} role from ${targetUser.role} to ${parsed.data.role}`,
        metadata: {
          targetEmail: targetUser.email,
          previousRole: targetUser.role,
          nextRole: parsed.data.role,
        },
      })
    })

    return { success: true }
  } catch (err) {
    logError('Failed to update role:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deactivateUser(
  orgId: string,
  targetUserId: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const session = await requireOrgAdminAccess(orgId)

    if (session.user.id === targetUserId) {
      return { error: 'You cannot deactivate your own account' }
    }

    const activeSuperAdmins = await db.query.users.findMany({
      where: and(
        eq(users.organisationId, orgId),
        eq(users.role, 'super_admin'),
        eq(users.isActive, true),
      ),
    })
    const isTarget = activeSuperAdmins.some((u) => u.id === targetUserId)
    if (isTarget && activeSuperAdmins.length === 1) {
      return { error: 'Cannot deactivate the last active super admin' }
    }

    await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(users.id, targetUserId), eq(users.organisationId, orgId)))

    await db.delete(sessions).where(eq(sessions.userId, targetUserId))

    return { success: true }
  } catch (err) {
    logError('Failed to deactivate user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function reactivateUser(
  orgId: string,
  targetUserId: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    await requireOrgAdminAccess(orgId)

    await db
      .update(users)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(users.id, targetUserId), eq(users.organisationId, orgId)))

    return { success: true }
  } catch (err) {
    logError('Failed to reactivate user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function removeUser(
  orgId: string,
  targetUserId: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    const session = await requireOrgAdminAccess(orgId)

    if (session.user.id === targetUserId) {
      return { error: 'You cannot remove your own account' }
    }

    const superAdmins = await db.query.users.findMany({
      where: and(
        eq(users.organisationId, orgId),
        eq(users.role, 'super_admin'),
        isNull(users.deletedAt),
      ),
    })
    const isTarget = superAdmins.some((u) => u.id === targetUserId)
    if (isTarget && superAdmins.length === 1) {
      return { error: 'Cannot remove the last super admin' }
    }

    const targetUser = await db.query.users.findFirst({
      where: and(eq(users.id, targetUserId), eq(users.organisationId, orgId), isNull(users.deletedAt)),
      columns: { id: true, email: true, role: true },
    })
    if (!targetUser) {
      return { error: 'User not found' }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(users.id, targetUserId), eq(users.organisationId, orgId)))

      await tx.delete(sessions).where(eq(sessions.userId, targetUserId))

      await writeAuditEvent(tx, {
        organisationId: orgId,
        actorUserId: session.user.id,
        action: 'user.removed',
        targetType: 'user',
        targetId: targetUser.id,
        summary: `Removed ${targetUser.email} from the organisation`,
        metadata: {
          targetEmail: targetUser.email,
          role: targetUser.role,
        },
      })
    })

    return { success: true }
  } catch (err) {
    logError('Failed to remove user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function cancelInvite(
  orgId: string,
  inviteId: string,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  try {
    await requireOrgAdminAccess(orgId)

    await db
      .update(invitations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invitations.id, inviteId), eq(invitations.organisationId, orgId)))

    return { success: true }
  } catch (err) {
    logError('Failed to cancel invite:', err)
    return { error: 'An unexpected error occurred' }
  }
}
