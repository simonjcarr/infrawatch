import 'server-only'

import { asc } from 'drizzle-orm'

import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'

export async function getDefaultInstanceId(): Promise<string | null> {
  const settings = await db.query.instanceSettings.findFirst({
    columns: { id: true },
    orderBy: [asc(instanceSettings.createdAt), asc(instanceSettings.id)],
  })

  return settings?.id ?? null
}
