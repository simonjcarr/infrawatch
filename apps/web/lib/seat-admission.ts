import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'

import { db } from '@/lib/db'
import { organisations, parseOrgMetadata, users } from '@/lib/db/schema'
import { validateLicenceKey } from '@/lib/licence'
import { FREE_INCLUDED_USER_SEATS } from '@/lib/licence-seats'
import { selectAdmittedSeatUserIds } from '@/lib/seat-selection'

export const SEAT_LIMIT_EXCEEDED_PATH = '/seat-limit-exceeded'

export class SeatAdmissionError extends Error {
  constructor() {
    super('User seat limit exceeded')
    this.name = 'SeatAdmissionError'
  }
}

async function getSeatLimit(orgId: string): Promise<number> {
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { licenceKey: true, licenceVerifierPublicKey: true },
  })
  if (!org?.licenceKey) return FREE_INCLUDED_USER_SEATS

  const result = await validateLicenceKey(org.licenceKey, {
    publicKeyPem: org.licenceVerifierPublicKey ?? undefined,
  })
  if (!result.valid || result.payload.sub !== orgId) {
    return FREE_INCLUDED_USER_SEATS
  }

  return result.payload.maxUsers ?? FREE_INCLUDED_USER_SEATS
}

export async function canUserAccessSeat(orgId: string, userId: string): Promise<boolean> {
  const [org, maxUsers] = await Promise.all([
    db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { metadata: true },
    }),
    getSeatLimit(orgId),
  ])
  if (!org) return false

  const activeUsers = await db.query.users.findMany({
    where: and(eq(users.organisationId, orgId), eq(users.isActive, true), isNull(users.deletedAt)),
    columns: { id: true, role: true, roles: true, createdAt: true },
    orderBy: [asc(users.createdAt), asc(users.id)],
  })
  if (activeUsers.length <= maxUsers) return true

  const metadata = parseOrgMetadata(org.metadata)
  const admitted = selectAdmittedSeatUserIds(
    activeUsers,
    metadata.freeSeatUserIds ?? [],
    maxUsers,
  )
  return admitted.includes(userId)
}

export async function assertUserCanAccessSeat(orgId: string, userId: string): Promise<void> {
  if (!await canUserAccessSeat(orgId, userId)) {
    throw new SeatAdmissionError()
  }
}
