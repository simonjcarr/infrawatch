import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'

import { db } from '@/lib/db'
import { instanceSettings, parseInstanceMetadata, users } from '@/lib/db/schema'
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

async function getSeatLimit(instanceId: string): Promise<number> {
  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { licenceKey: true, licenceVerifierPublicKey: true },
  })
  if (!instance?.licenceKey) return FREE_INCLUDED_USER_SEATS

  const result = await validateLicenceKey(instance.licenceKey, {
    publicKeyPem: instance.licenceVerifierPublicKey ?? undefined,
  })
  if (!result.valid || result.payload.sub !== instanceId) {
    return FREE_INCLUDED_USER_SEATS
  }

  return result.payload.maxUsers ?? FREE_INCLUDED_USER_SEATS
}

export async function canUserAccessSeat(instanceId: string, userId: string): Promise<boolean> {
  const [instance, maxUsers] = await Promise.all([
    db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { metadata: true },
    }),
    getSeatLimit(instanceId),
  ])
  if (!instance) return false

  const activeUsers = await db.query.users.findMany({
    where: and(eq(users.instanceId, instanceId), eq(users.isActive, true), isNull(users.deletedAt)),
    columns: { id: true, role: true, roles: true, createdAt: true },
    orderBy: [asc(users.createdAt), asc(users.id)],
  })
  if (activeUsers.length <= maxUsers) return true

  const metadata = parseInstanceMetadata(instance.metadata)
  const admitted = selectAdmittedSeatUserIds(
    activeUsers,
    metadata.freeSeatUserIds ?? [],
    maxUsers,
  )
  return admitted.includes(userId)
}

export async function assertUserCanAccessSeat(instanceId: string, userId: string): Promise<void> {
  if (!await canUserAccessSeat(instanceId, userId)) {
    throw new SeatAdmissionError()
  }
}
