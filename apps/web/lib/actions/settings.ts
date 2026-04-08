'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateLicenceKey } from '@/lib/licence'
import { getRequiredSession } from '@/lib/auth/session'

const ADMIN_ROLES = ['org_admin', 'super_admin']

const updateOrgNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})

export async function updateOrgName(
  orgId: string,
  name: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = updateOrgNameSchema.safeParse({ name })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid name' }
  }

  try {
    await db
      .update(organisations)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    return { success: true }
  } catch (err) {
    console.error('Failed to update org name:', err)
    return { error: 'An unexpected error occurred' }
  }
}

const metricRetentionSchema = z.object({
  days: z.number().int().min(1).max(3650),
})

export async function updateMetricRetention(
  orgId: string,
  days: number,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = metricRetentionSchema.safeParse({ days })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid value' }
  }

  try {
    await db
      .update(organisations)
      .set({ metricRetentionDays: parsed.data.days, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    return { success: true }
  } catch (err) {
    console.error('Failed to update metric retention:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function saveLicenceKey(
  orgId: string,
  key: string,
): Promise<{ success: true; tier: string } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }

  const result = await validateLicenceKey(key.trim())
  if (!result.valid) {
    return { error: result.error }
  }

  try {
    await db
      .update(organisations)
      .set({
        licenceKey: key.trim(),
        licenceTier: result.payload.tier,
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, orgId))

    return { success: true, tier: result.payload.tier }
  } catch (err) {
    console.error('Failed to save licence key:', err)
    return { error: 'An unexpected error occurred' }
  }
}
