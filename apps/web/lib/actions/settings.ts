'use server'

import { logError } from '@/lib/logging'
import { requireInstanceAdminAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { createId } from '@paralleldrive/cuid2'
import { db } from '@/lib/db'
import { instanceSettings, parseInstanceMetadata, users } from '@/lib/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { validateLicenceKey } from '@/lib/licence'
import { encodeActivationToken } from '@/lib/licence-activation-token'
import { writeAuditEvent } from '@/lib/audit/events'
import { FREE_INCLUDED_USER_SEATS } from '@/lib/licence-seats'
import { getTrustedEffectiveLicence } from '@/lib/actions/licence-guard'
import { getRequiredSession } from '@/lib/auth/session'
import { resolveOptionalActionScope } from './action-scope'

const updateOrgNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})

export async function getCurrentInstanceSettingsRecord() {
  const session = await getRequiredSession()
  const instanceId = resolveOptionalActionScope(session)
  if (!instanceId) return null
  return db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
  })
}

export async function updateOrgName(
  instanceId: string,
  name: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = updateOrgNameSchema.safeParse({ name })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid name' }
  }

  try {
    await db
      .update(instanceSettings)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    return { success: true }
  } catch (err) {
    logError('Failed to update org name:', err)
    return { error: 'An unexpected error occurred' }
  }
}

const metricRetentionSchema = z.object({
  days: z.number().int().min(1).max(3650),
})

const dockerMetricRetentionSchema = z.object({
  days: z.number().int().min(1).max(365),
})

export async function updateMetricRetention(
  instanceId: string,
  days: number,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = metricRetentionSchema.safeParse({ days })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid value' }
  }

  try {
    await db
      .update(instanceSettings)
      .set({ metricRetentionDays: parsed.data.days, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

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
    logError('Failed to update metric retention:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateDockerMetricRetention(
  instanceId: string,
  days: number,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = dockerMetricRetentionSchema.safeParse({ days })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid value' }
  }

  try {
    await db
      .update(instanceSettings)
      .set({ dockerMetricRetentionDays: parsed.data.days, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    return { success: true }
  } catch (err) {
    logError('Failed to update Docker metric retention:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function saveLicenceKey(
  instanceId: string,
  key: string,
): Promise<{
  success: true
  tier: string
  maxUsers: number
  previousTier: string
  previousMaxUsers: number
} | { error: string }> {
  let session
  try {
    session = await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  const result = await validateLicenceKey(key.trim())
  if (!result.valid) {
    return { error: result.error }
  }

  if (result.payload.sub !== instanceId) {
    return { error: 'Licence key was issued to a different instance' }
  }

  try {
    const previousLicence = await getTrustedEffectiveLicence(instanceId)
    const nextMaxUsers = result.payload.maxUsers ?? FREE_INCLUDED_USER_SEATS

    await db
      .update(instanceSettings)
      .set({
        licenceKey: key.trim(),
        licenceTier: result.payload.tier,
        licenceVerifierPublicKey: result.verifierPublicKeyPem,
        licenceVerifierPublicKeyFingerprint: result.verifierPublicKeyFingerprint,
        updatedAt: new Date(),
      })
      .where(eq(instanceSettings.id, instanceId))

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'licence.updated',
      targetType: 'instance',
      targetId: instanceId,
      summary: `Updated instance licence to ${result.payload.tier}`,
      metadata: {
        previousTier: previousLicence.tier,
        nextTier: result.payload.tier,
        previousMaxUsers: previousLicence.maxUsers ?? FREE_INCLUDED_USER_SEATS,
        nextMaxUsers,
      },
    })

    return {
      success: true,
      tier: result.payload.tier,
      maxUsers: nextMaxUsers,
      previousTier: previousLicence.tier,
      previousMaxUsers: previousLicence.maxUsers ?? FREE_INCLUDED_USER_SEATS,
    }
  } catch (err) {
    logError('Failed to save licence key:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function generateActivationToken(
  instanceId: string,
): Promise<{ success: true; token: string } | { error: string }> {
  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  try {
    const org = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { id: true, name: true },
    })
    if (!org) {
      return { error: 'Instance not found' }
    }

    const token = encodeActivationToken({
      installOrgId: org.id,
      installOrgName: org.name,
      nonce: createId(),
    })
    return { success: true, token }
  } catch (err) {
    logError('Failed to generate activation token:', err)
    return { error: 'An unexpected error occurred' }
  }
}

const freeSeatUsersSchema = z.object({
  userIds: z.array(z.string()).max(FREE_INCLUDED_USER_SEATS),
})

export async function updateFreeSeatUsers(
  instanceId: string,
  userIds: string[],
): Promise<{ success: true; userIds: string[] } | { error: string }> {
  let session
  try {
    session = await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to perform this action' }
  }

  const parsed = freeSeatUsersSchema.safeParse({ userIds })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid free-seat users' }
  }

  const uniqueUserIds = Array.from(new Set(parsed.data.userIds))
  if (uniqueUserIds.length > FREE_INCLUDED_USER_SEATS) {
    return { error: `Select up to ${FREE_INCLUDED_USER_SEATS} included-seat users` }
  }

  try {
    const [org, activeUsers] = await Promise.all([
      db.query.instanceSettings.findFirst({
        where: eq(instanceSettings.id, instanceId),
        columns: { metadata: true },
      }),
      uniqueUserIds.length === 0
        ? Promise.resolve([])
        : db.query.users.findMany({
            where: and(
              eq(users.instanceId, instanceId),
              eq(users.isActive, true),
              isNull(users.deletedAt),
              inArray(users.id, uniqueUserIds),
            ),
            columns: { id: true },
          }),
    ])

    if (!org) {
      return { error: 'Instance not found' }
    }

    const activeIds = new Set(activeUsers.map((user) => user.id))
    const invalidUserId = uniqueUserIds.find((userId) => !activeIds.has(userId))
    if (invalidUserId) {
      return { error: 'Included-seat users must be active members of this instance' }
    }

    const metadata = {
      ...parseInstanceMetadata(org.metadata),
      freeSeatUserIds: uniqueUserIds,
    }

    await db
      .update(instanceSettings)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    await writeAuditEvent(db, {
      instanceId: instanceId,
      actorUserId: session.user.id,
      action: 'licence.free_seats.updated',
      targetType: 'instance',
      targetId: instanceId,
      summary: 'Updated included free-seat users',
      metadata: { freeSeatUserIds: uniqueUserIds },
    })

    return { success: true, userIds: uniqueUserIds }
  } catch (err) {
    logError('Failed to update free-seat users:', err)
    return { error: 'An unexpected error occurred' }
  }
}
