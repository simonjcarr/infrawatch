import 'server-only'

import { asc, isNull } from 'drizzle-orm'

import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'

export async function getDefaultOrganisationId(): Promise<string | null> {
  const organisation = await db.query.organisations.findFirst({
    where: isNull(organisations.deletedAt),
    columns: { id: true },
    orderBy: [asc(organisations.createdAt), asc(organisations.id)],
  })

  return organisation?.id ?? null
}
