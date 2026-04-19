'use server'

import { z } from 'zod'
import { createId } from '@paralleldrive/cuid2'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { validateLicenceKey } from '@/lib/licence'
import { encodeActivationToken } from '@/lib/licence-activation-token'
import { getRequiredSession } from '@/lib/auth/session'
import { hasLicenceFeature } from '@/lib/actions/licence-guard'
import { COMMUNITY_MAX_RETENTION_DAYS } from '@/lib/features'
import { ADMIN_ROLES } from '@/lib/auth/roles'

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

  const canExtend = await hasLicenceFeature(orgId, 'metricRetentionExtended')
  if (!canExtend && parsed.data.days > COMMUNITY_MAX_RETENTION_DAYS) {
    return {
      error: `Retention above ${COMMUNITY_MAX_RETENTION_DAYS} days requires a Pro or Enterprise licence`,
    }
  }

  try {
    await db
      .update(organisations)
      .set({ metricRetentionDays: parsed.data.days, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    // Update TimescaleDB retention policies for both metric hypertables.
    // Each statement is wrapped in its own try/catch so failures silently degrade
    // on plain PostgreSQL (where these functions do not exist).
    // make_interval(days => N) uses a proper query parameter — no sql.raw required.
    const d = parsed.data.days
    for (const table of ['host_metrics', 'check_results']) {
      try {
        await db.execute(sql`SELECT drop_retention_policy(${table}, if_exists => true)`)
      } catch {
        // TimescaleDB not available
      }
      try {
        await db.execute(
          sql`SELECT add_retention_policy(${table}, make_interval(days => ${d}), if_not_exists => true)`,
        )
      } catch {
        // TimescaleDB not available
      }
    }

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

  if (result.payload.sub !== orgId) {
    return { error: 'Licence key was issued to a different organisation' }
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

export async function generateActivationToken(
  orgId: string,
): Promise<{ success: true; token: string } | { error: string }> {
  const session = await getRequiredSession()
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to perform this action' }
  }
  if (session.user.organisationId !== orgId) {
    return { error: 'You can only generate activation tokens for your own organisation' }
  }

  try {
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, name: true },
    })
    if (!org) {
      return { error: 'Organisation not found' }
    }

    const token = encodeActivationToken({
      installOrgId: org.id,
      installOrgName: org.name,
      nonce: createId(),
    })
    return { success: true, token }
  } catch (err) {
    console.error('Failed to generate activation token:', err)
    return { error: 'An unexpected error occurred' }
  }
}
