'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { organisations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { OrgMetadata, OrgNotificationSettings } from '@/lib/db/schema/organisations'
import { getRequiredSession } from '@/lib/auth/session'

const ADMIN_ROLES = ['org_admin', 'super_admin'] as const

const DEFAULT_ROLES = ['super_admin', 'org_admin', 'engineer']

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
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })
  const meta = (org?.metadata ?? {}) as OrgMetadata
  const ns = meta.notificationSettings ?? {}
  return {
    inAppEnabled: ns.inAppEnabled !== false,
    inAppRoles: ns.inAppRoles ?? DEFAULT_ROLES,
    allowUserOptOut: ns.allowUserOptOut !== false,
  }
}

export async function updateOrgNotificationSettings(
  orgId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()

  if (!ADMIN_ROLES.includes(session.user.role as (typeof ADMIN_ROLES)[number])) {
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

  const currentMetadata = (org.metadata ?? {}) as OrgMetadata
  const updatedMetadata: OrgMetadata = {
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
