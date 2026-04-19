'use server'

import { and, eq, gte, isNull, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { licences } from '@/lib/db/schema'
import { getOptionalSession, getRequiredSession } from '@/lib/auth/session'
import type { Licence } from '@/lib/db/schema'

export async function listLicencesForOrganisation(): Promise<Licence[]> {
  const { user } = await getRequiredSession()
  if (!user.organisationId) return []
  return db.query.licences.findMany({
    where: and(eq(licences.organisationId, user.organisationId), isNull(licences.revokedAt)),
    orderBy: [desc(licences.issuedAt)],
  })
}

export async function getLicenceById(id: string): Promise<Licence | null> {
  const { user } = await getRequiredSession()
  if (!user.organisationId) return null
  const result = await db.query.licences.findFirst({
    where: and(eq(licences.id, id), eq(licences.organisationId, user.organisationId)),
  })
  return result ?? null
}

// Polled by the checkout-success client while the Stripe webhook finishes its
// round-trip. Returns the id of the most-recent licence issued in the last
// hour — enough for the UI to know the purchase completed and redirect.
export async function getRecentLicenceIdForCurrentUser(): Promise<string | null> {
  const session = await getOptionalSession()
  const organisationId = session?.user.organisationId
  if (!organisationId) return null
  const cutoff = new Date(Date.now() - 60 * 60 * 1000)
  const result = await db.query.licences.findFirst({
    where: and(
      eq(licences.organisationId, organisationId),
      isNull(licences.revokedAt),
      gte(licences.issuedAt, cutoff),
    ),
    orderBy: [desc(licences.issuedAt)],
    columns: { id: true },
  })
  return result?.id ?? null
}
