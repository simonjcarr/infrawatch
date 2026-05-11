'use server'

import { logError } from '@/lib/logging'
import { requireInstanceAccess, requireInstanceAdminAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { users, invitations, sessions } from '@/lib/db/schema'
import { eq, and, isNull, isNotNull, gt, or, sql } from 'drizzle-orm'
import type { User, Invitation } from '@/lib/db/schema'
import { getBetterAuthOrigin } from '@/lib/auth/env'
import { getRequiredSession } from '@/lib/auth/session'
import { writeAuditEvent } from '@/lib/audit/events'
import { ASSIGNED_ROLES, INVITABLE_ROLES, getPrimaryRole, normalizeAssignedRoles } from '@/lib/auth/roles'
import { assertCanReserveUserSeat, toSeatLimitErrorMessage } from '@/lib/actions/seat-enforcement'
import { resolveCurrentActionScope, resolveOptionalActionScope } from './action-scope'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  roles: z.array(z.enum(INVITABLE_ROLES)).min(1, 'Select at least one role'),
})

const updateRoleSchema = z.object({
  roles: z.array(z.enum(ASSIGNED_ROLES)).min(1, 'Select at least one role'),
})

function formatRoles(roles: readonly string[]): string {
  return roles.join(', ')
}

function hasSuperAdminRole(role: string | null | undefined, roles: readonly string[] | null | undefined): boolean {
  return normalizeAssignedRoles(roles, role).includes('super_admin')
}

async function claimDirectSignupUsers(instanceId: string): Promise<void> {
  await db.execute(sql`
    UPDATE "user" AS u
    SET instance_id = ${instanceId},
        role = CASE
          WHEN u.role = 'super_admin' OR u.roles ? 'super_admin' THEN 'super_admin'
          ELSE 'pending'
        END,
        roles = CASE
          WHEN u.role = 'super_admin' OR u.roles ? 'super_admin' THEN '["super_admin"]'::jsonb
          ELSE '[]'::jsonb
        END,
        updated_at = NOW()
    WHERE u.instance_id IS NULL
      AND u.deleted_at IS NULL
  `)
}

export async function getOrgUsers(): Promise<{ members: User[]; pendingInvites: Invitation[] }> {
  const session = await getRequiredSession()
  const currentScope = resolveOptionalActionScope(session)
  if (!currentScope) return { members: [session.user], pendingInvites: [] }
  await requireInstanceAccess(currentScope)
  await claimDirectSignupUsers(currentScope)

  const [members, pendingInvites] = await Promise.all([
    db.query.users.findMany({
      where: and(eq(users.instanceId, currentScope), isNull(users.deletedAt)),
    }),
    db.query.invitations.findMany({
      where: and(
        eq(invitations.instanceId, currentScope),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    }),
  ])
  return { members, pendingInvites }
}

export async function inviteUser(
  input: { email: string; roles: string[] },
): Promise<{ inviteLink: string } | { restored: true } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveOptionalActionScope(session)
  if (!currentScope) return { error: 'Team invitations require an instance to be configured' }
  const instanceId = currentScope
  await requireInstanceAccess(instanceId)
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const nextRoles = normalizeAssignedRoles(parsed.data.roles)
  const nextRole = getPrimaryRole(nextRoles)

  try {
    const adminSession = await requireInstanceAdminAccess(instanceId)

    // Check for a previously removed user — restore them rather than re-registering,
    // since their account (and email) still exist in the database.
    const removedUser = await db.query.users.findFirst({
      where: and(
        eq(users.email, parsed.data.email),
        eq(users.instanceId, instanceId),
        isNotNull(users.deletedAt),
      ),
    })
    if (removedUser) {
      await assertCanReserveUserSeat(instanceId)
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ deletedAt: null, isActive: true, role: nextRole, roles: nextRoles, updatedAt: new Date() })
          .where(eq(users.id, removedUser.id))

        await writeAuditEvent(tx, {
          instanceId: instanceId,
          actorUserId: adminSession.user.id,
          action: 'user.restored',
          targetType: 'user',
          targetId: removedUser.id,
          summary: `Restored ${removedUser.email} to the instance`,
          metadata: {
            targetEmail: removedUser.email,
            previousRole: removedUser.role,
            previousRoles: normalizeAssignedRoles(removedUser.roles, removedUser.role),
            nextRole,
            nextRoles,
          },
        })
      })
      return { restored: true }
    }

    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.email, parsed.data.email),
        eq(users.instanceId, instanceId),
        isNull(users.deletedAt),
      ),
    })
    if (existing) {
      return { error: 'This user is already a member of your instance' }
    }

    const existingInvite = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.email, parsed.data.email),
        eq(invitations.instanceId, instanceId),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    })
    if (existingInvite) {
      return { error: 'An invitation has already been sent to this email address' }
    }

    await assertCanReserveUserSeat(instanceId)

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const invite = await db.transaction(async (tx) => {
      const [createdInvite] = await tx
        .insert(invitations)
        .values({
          email: parsed.data.email,
          role: nextRole,
          roles: nextRoles,
          instanceId: instanceId,
          invitedById: adminSession.user.id,
          expiresAt,
        })
        .returning()

      if (!createdInvite) return null

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: adminSession.user.id,
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: createdInvite.id,
        summary: `Invited ${createdInvite.email} to the instance`,
        metadata: {
          targetEmail: createdInvite.email,
          role: createdInvite.role,
          roles: normalizeAssignedRoles(createdInvite.roles, createdInvite.role),
          expiresAt: createdInvite.expiresAt,
        },
      })

      return createdInvite
    })

    if (!invite) return { error: 'Failed to create invitation' }

    const baseUrl = getBetterAuthOrigin()
    return { inviteLink: `${baseUrl}/register?invite=${invite.token}` }
  } catch (err) {
    const seatLimitMessage = toSeatLimitErrorMessage(err)
    if (seatLimitMessage) {
      return { error: seatLimitMessage }
    }
    logError('Failed to invite user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateUserRole(
  targetUserId: string,
  roles: string[],
): Promise<{ success: true } | { error: string }> {
  const currentScope = resolveCurrentActionScope(await getRequiredSession())
  const instanceId = currentScope
  await requireInstanceAccess(instanceId)
  const parsed = updateRoleSchema.safeParse({ roles })
  if (!parsed.success) {
    return { error: 'Invalid role' }
  }

  const nextRoles = normalizeAssignedRoles(parsed.data.roles)
  const nextRole = getPrimaryRole(nextRoles)

  try {
    const session = await requireInstanceAdminAccess(instanceId)
    const targetUserWhere = or(
      and(eq(users.id, targetUserId), eq(users.instanceId, instanceId), isNull(users.deletedAt)),
      and(eq(users.id, targetUserId), isNull(users.instanceId), eq(users.role, 'pending'), isNull(users.deletedAt)),
    )
    const targetUser = await db.query.users.findFirst({
      where: targetUserWhere,
      columns: { id: true, email: true, role: true, roles: true },
    })
    if (!targetUser) {
      return { error: 'User not found' }
    }

    if (hasSuperAdminRole(targetUser.role, targetUser.roles) && !nextRoles.includes('super_admin')) {
      const orgUsers = await db.query.users.findMany({
        where: and(eq(users.instanceId, instanceId), isNull(users.deletedAt)),
        columns: { id: true, role: true, roles: true },
      })
      const superAdmins = orgUsers.filter((user) => hasSuperAdminRole(user.role, user.roles))
      if (superAdmins.length === 1 && superAdmins[0]?.id === targetUserId) {
        return { error: 'Cannot demote the last super admin' }
      }
    }

    const previousRoles = normalizeAssignedRoles(targetUser.roles, targetUser.role)

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ instanceId, role: nextRole, roles: nextRoles, updatedAt: new Date() })
        .where(targetUserWhere)

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'user.role.updated',
        targetType: 'user',
        targetId: targetUser.id,
        summary: `Changed ${targetUser.email} roles from ${formatRoles(previousRoles)} to ${formatRoles(nextRoles)}`,
        metadata: {
          targetEmail: targetUser.email,
          previousRole: targetUser.role,
          previousRoles,
          nextRole,
          nextRoles,
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
  targetUserId: string,
): Promise<{ success: true } | { error: string }> {
  const currentScope = resolveCurrentActionScope(await getRequiredSession())
  const instanceId = currentScope
  await requireInstanceAccess(instanceId)
  try {
    const session = await requireInstanceAdminAccess(instanceId)

    if (session.user.id === targetUserId) {
      return { error: 'You cannot deactivate your own account' }
    }

    const targetUser = await db.query.users.findFirst({
      where: and(eq(users.id, targetUserId), eq(users.instanceId, instanceId), isNull(users.deletedAt)),
      columns: { id: true, email: true, isActive: true, role: true, roles: true },
    })
    if (!targetUser) {
      return { error: 'User not found' }
    }

    const activeSuperAdmins = await db.query.users.findMany({
      where: and(
        eq(users.instanceId, instanceId),
        eq(users.isActive, true),
      ),
      columns: { id: true, role: true, roles: true },
    })
    const superAdmins = activeSuperAdmins.filter((user) => hasSuperAdminRole(user.role, user.roles))
    const isTarget = superAdmins.some((user) => user.id === targetUserId)
    if (isTarget && superAdmins.length === 1) {
      return { error: 'Cannot deactivate the last active super admin' }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(users.id, targetUserId), eq(users.instanceId, instanceId)))

      await tx.delete(sessions).where(eq(sessions.userId, targetUserId))

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'user.deactivated',
        targetType: 'user',
        targetId: targetUser.id,
        summary: `Deactivated ${targetUser.email}`,
        metadata: {
          targetEmail: targetUser.email,
          previousActive: targetUser.isActive,
          nextActive: false,
          role: targetUser.role,
          roles: normalizeAssignedRoles(targetUser.roles, targetUser.role),
        },
      })
    })

    return { success: true }
  } catch (err) {
    logError('Failed to deactivate user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function reactivateUser(
  targetUserId: string,
): Promise<{ success: true } | { error: string }> {
  const currentScope = resolveCurrentActionScope(await getRequiredSession())
  const instanceId = currentScope
  await requireInstanceAccess(instanceId)
  try {
    const session = await requireInstanceAdminAccess(instanceId)

    const targetUser = await db.query.users.findFirst({
      where: and(eq(users.id, targetUserId), eq(users.instanceId, instanceId), isNull(users.deletedAt)),
      columns: { id: true, email: true, isActive: true, role: true, roles: true },
    })
    if (!targetUser) {
      return { error: 'User not found' }
    }

    if (!targetUser.isActive) {
      await assertCanReserveUserSeat(instanceId)
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ isActive: true, updatedAt: new Date() })
        .where(and(eq(users.id, targetUserId), eq(users.instanceId, instanceId)))

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'user.reactivated',
        targetType: 'user',
        targetId: targetUser.id,
        summary: `Reactivated ${targetUser.email}`,
        metadata: {
          targetEmail: targetUser.email,
          previousActive: targetUser.isActive,
          nextActive: true,
          role: targetUser.role,
          roles: normalizeAssignedRoles(targetUser.roles, targetUser.role),
        },
      })
    })

    return { success: true }
  } catch (err) {
    const seatLimitMessage = toSeatLimitErrorMessage(err)
    if (seatLimitMessage) {
      return { error: seatLimitMessage }
    }
    logError('Failed to reactivate user:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function removeUser(
  targetUserId: string,
): Promise<{ success: true } | { error: string }> {
  const currentScope = resolveCurrentActionScope(await getRequiredSession())
  const instanceId = currentScope
  await requireInstanceAccess(instanceId)
  try {
    const session = await requireInstanceAdminAccess(instanceId)

    if (session.user.id === targetUserId) {
      return { error: 'You cannot remove your own account' }
    }

    const superAdmins = await db.query.users.findMany({
      where: and(
        eq(users.instanceId, instanceId),
        isNull(users.deletedAt),
      ),
      columns: { id: true, role: true, roles: true },
    })
    const remainingSuperAdmins = superAdmins.filter((user) => hasSuperAdminRole(user.role, user.roles))
    const isTarget = remainingSuperAdmins.some((user) => user.id === targetUserId)
    if (isTarget && remainingSuperAdmins.length === 1) {
      return { error: 'Cannot remove the last super admin' }
    }

    const targetUser = await db.query.users.findFirst({
      where: and(eq(users.id, targetUserId), eq(users.instanceId, instanceId), isNull(users.deletedAt)),
      columns: { id: true, email: true, role: true, roles: true },
    })
    if (!targetUser) {
      return { error: 'User not found' }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(users.id, targetUserId), eq(users.instanceId, instanceId)))

      await tx.delete(sessions).where(eq(sessions.userId, targetUserId))

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'user.removed',
        targetType: 'user',
        targetId: targetUser.id,
        summary: `Removed ${targetUser.email} from the instance`,
        metadata: {
          targetEmail: targetUser.email,
          role: targetUser.role,
          roles: normalizeAssignedRoles(targetUser.roles, targetUser.role),
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
  inviteId: string,
): Promise<{ success: true } | { error: string }> {
  const currentScope = resolveCurrentActionScope(await getRequiredSession())
  const instanceId = currentScope
  await requireInstanceAccess(instanceId)
  try {
    const session = await requireInstanceAdminAccess(instanceId)

    const invite = await db.query.invitations.findFirst({
      where: and(eq(invitations.id, inviteId), eq(invitations.instanceId, instanceId), isNull(invitations.deletedAt)),
      columns: { id: true, email: true, role: true, roles: true, expiresAt: true },
    })
    if (!invite) {
      return { error: 'Invitation not found' }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(invitations)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invitations.id, inviteId), eq(invitations.instanceId, instanceId)))

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'invitation.cancelled',
        targetType: 'invitation',
        targetId: invite.id,
        summary: `Cancelled invitation for ${invite.email}`,
        metadata: {
          targetEmail: invite.email,
          role: invite.role,
          roles: normalizeAssignedRoles(invite.roles, invite.role),
          expiresAt: invite.expiresAt,
        },
      })
    })

    return { success: true }
  } catch (err) {
    logError('Failed to cancel invite:', err)
    return { error: 'An unexpected error occurred' }
  }
}
