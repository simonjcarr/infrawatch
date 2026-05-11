import 'server-only'

import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'

export const PRODUCT_DISPLAY_NAME = 'CT-Ops'

export async function getInstanceDisplayName(instanceId?: string | null): Promise<string> {
  if (!instanceId) return PRODUCT_DISPLAY_NAME

  const instance = await db.query.instanceSettings.findFirst({
    columns: { name: true },
    where: eq(instanceSettings.id, instanceId),
  })

  return instance?.name.trim() || PRODUCT_DISPLAY_NAME
}
