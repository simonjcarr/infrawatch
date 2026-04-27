'use server'

import { logError } from '@/lib/logging'
import { z } from 'zod'
import { db } from '@/lib/db'
import { organisations, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { Organisation } from '@/lib/db/schema'

const createOrganisationSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, {
    message: 'Slug can only contain lowercase letters, numbers, and hyphens',
  }),
})

export async function createOrganisation(
  userId: string,
  input: z.infer<typeof createOrganisationSchema>,
): Promise<{ organisation: Organisation } | { error: string }> {
  const parsed = createOrganisationSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    const existing = await db.query.organisations.findFirst({
      where: eq(organisations.slug, parsed.data.slug),
    })
    if (existing) {
      return { error: 'An organisation with this slug already exists' }
    }

    const [organisation] = await db
      .insert(organisations)
      .values({
        name: parsed.data.name,
        slug: parsed.data.slug,
      })
      .returning()

    if (!organisation) {
      return { error: 'Failed to create organisation' }
    }

    // Link the user to the organisation as super_admin
    await db
      .update(users)
      .set({ organisationId: organisation.id, role: 'super_admin' })
      .where(eq(users.id, userId))

    return { organisation }
  } catch (err) {
    logError('Failed to create organisation:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getOrganisationBySlug(
  slug: string,
): Promise<Organisation | null> {
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.slug, slug),
  })
  return org ?? null
}
