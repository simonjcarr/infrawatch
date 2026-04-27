'use server'

import { requireOrgAccess } from '@/lib/actions/action-auth'

import { z } from 'zod'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseOrgMetadata } from '@/lib/db/schema/organisations'
import type { OrgNotificationSettings } from '@/lib/db/schema/organisations'
import { getRequiredSession } from '@/lib/auth/session'
import { ADMIN_ROLES, DEFAULT_NOTIFICATION_ROLES } from '@/lib/auth/roles'

const updateOrgNotificationSettingsSchema = z.object({
  inAppEnabled: z.boolean(),
  inAppRoles: z.array(z.string()).min(1, 'At least one role must be selected'),
  allowUserOptOut: z.boolean(),
})

export type OrgNotificationSettingsInput = z.infer<typeof updateOrgNotificationSettingsSchema>

export interface OrgNotificationSettingsFull {
  inAppEnabled: boolean
  inAppRoles: string[]
  allowUserOptOut: boolean
}

export async function getOrgNotificationSettings(
  orgId: string,
): Promise<OrgNotificationSettingsFull> {
  await requireOrgAccess(orgId)
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = parseOrgMetadata(org?.metadata)
  const ns = meta.notificationSettings ?? {}
  return {
    inAppEnabled: ns.inAppEnabled !== false,
    inAppRoles: ns.inAppRoles ?? [...DEFAULT_NOTIFICATION_ROLES],
    allowUserOptOut: ns.allowUserOptOut !== false,
  }
}

export async function updateOrgNotificationSettings(
  orgId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAccess(orgId)
  const session = await getRequiredSession()

  if (!ADMIN_ROLES.includes(session.user.role)) {
    return { error: 'You do not have permission to update notification settings' }
  }

  if (session.user.organisationId !== orgId) {
    return { error: 'Organisation mismatch' }
  }

  const parsed = updateOrgNotificationSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { inAppEnabled, inAppRoles, allowUserOptOut } = parsed.data

  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  if (!org) return { error: 'Organisation not found' }

  const currentMetadata = parseOrgMetadata(org.metadata)
  const updatedMetadata = {
    ...currentMetadata,
    notificationSettings: {
      inAppEnabled,
      inAppRoles,
      allowUserOptOut,
    } satisfies OrgNotificationSettings,
  }

  try {
    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))
    return { success: true }
  } catch {
    return { error: 'Failed to update notification settings' }
  }
}
