import 'server-only'

import { and, count, eq, gt, isNull, ne } from 'drizzle-orm'

import { db } from '@/lib/db'
import { invitations, users } from '@/lib/db/schema'
import { calculateSeatUsage, canReserveSeats, formatSeatLimitError, type SeatUsage } from '@/lib/licence-seats'
import { getTrustedEffectiveLicence } from '@/lib/actions/licence-guard'

type SeatUsageOptions = {
  excludeInviteId?: string
}

export class SeatLimitError extends Error {
  constructor(public usage: SeatUsage) {
    super(formatSeatLimitError(usage))
    this.name = 'SeatLimitError'
  }
}

export async function getOrgSeatUsage(orgId: string, options: SeatUsageOptions = {}): Promise<SeatUsage> {
  const licence = await getTrustedEffectiveLicence(orgId)
  const now = new Date()

  const pendingInviteWhere = options.excludeInviteId
    ? and(
        eq(invitations.organisationId, orgId),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now),
        ne(invitations.id, options.excludeInviteId),
      )
    : and(
        eq(invitations.organisationId, orgId),
        isNull(invitations.deletedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now),
      )

  const [activeUsersRow, pendingInvitesRow] = await Promise.all([
    db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.organisationId, orgId), eq(users.isActive, true), isNull(users.deletedAt))),
    db.select({ total: count() }).from(invitations).where(pendingInviteWhere),
  ])

  return calculateSeatUsage({
    activeUsers: activeUsersRow[0]?.total ?? 0,
    pendingInvites: pendingInvitesRow[0]?.total ?? 0,
    maxUsers: licence.maxUsers,
  })
}

export async function assertCanReserveUserSeat(
  orgId: string,
  options: SeatUsageOptions = {},
): Promise<SeatUsage> {
  const usage = await getOrgSeatUsage(orgId, options)
  if (!canReserveSeats(usage, 1)) {
    throw new SeatLimitError(usage)
  }
  return usage
}

export function toSeatLimitErrorMessage(err: unknown): string | null {
  return err instanceof SeatLimitError ? err.message : null
}
