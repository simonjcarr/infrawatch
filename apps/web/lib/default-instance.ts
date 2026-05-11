import 'server-only'

import { asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { instanceSettings } from '@/lib/db/schema'

function getConfiguredInstanceId(): string | null {
  const id = process.env['CT_OPS_INSTANCE_ID']?.trim()
  return id || null
}

function toInstanceSlug(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'ct-ops'
}

async function ensureConfiguredDefaultInstance(): Promise<string | null> {
  const id = getConfiguredInstanceId()
  if (!id) return null

  await db
    .insert(instanceSettings)
    .values({
      id,
      name: 'CT-Ops',
      slug: toInstanceSlug(id),
    })
    .onConflictDoNothing()

  const settings = await db.query.instanceSettings.findFirst({
    columns: { id: true },
    where: eq(instanceSettings.id, id),
  })

  return settings?.id ?? null
}

export async function getDefaultInstanceId(): Promise<string | null> {
  const settings = await db.query.instanceSettings.findFirst({
    columns: { id: true },
    orderBy: [asc(instanceSettings.createdAt), asc(instanceSettings.id)],
  })

  return settings?.id ?? await ensureConfiguredDefaultInstance()
}
