'use server'

import { logError } from '@/lib/logging'
import { requireInstanceAccess, requireInstanceAdminAccess, requireInstanceWriteAccess } from '@/lib/actions/action-auth'
import { getRequiredSession } from '@/lib/auth/session'

import { z } from 'zod'
import { db } from '@/lib/db'
import { hosts, instanceSettings, checks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { HostCollectionSettings } from '@/lib/db/schema'
import { DEFAULT_COLLECTION_SETTINGS } from '@/lib/db/schema'
import { parseHostMetadata } from '@/lib/db/schema/hosts'
import { parseInstanceMetadata } from '@/lib/db/schema/instance-settings'
import { resolveCurrentActionScope } from './action-scope'
import { createCheck, updateCheck } from '@/lib/actions/checks'

export interface HostDockerRetentionSettings {
  globalRetentionDays: number
  retentionDaysOverride: number | null
  effectiveRetentionDays: number
}

const hostDockerRetentionOverrideSchema = z.object({
  days: z.number().int().min(1).max(365).nullable(),
})

export async function getHostCollectionSettings(
  ...args: [string] | [string, string]
): Promise<HostCollectionSettings> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  await requireInstanceAccess(currentScope)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })

  const metadata = parseHostMetadata(host?.metadata)
  if (metadata.collectionSettings) {
    return metadata.collectionSettings
  }

  // Fall back to instance defaults
  return getInstanceDefaultCollectionSettings(currentScope)
}

export async function updateHostCollectionSettings(
  ...args: [string, HostCollectionSettings] | [string, string, HostCollectionSettings]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, hostId, settings] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  await requireInstanceWriteAccess(currentScope)
  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
      columns: { id: true, metadata: true },
    })
    if (!host) return { error: 'Host not found' }

    const currentMetadata = parseHostMetadata(host.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      collectionSettings: settings,
    }

    await db
      .update(hosts)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope)))

    // Auto-manage service_account and ssh_key_scan checks based on localUsers toggle
    await syncLocalUserChecks(currentScope, hostId, settings.localUsers)

    return { success: true }
  } catch (err) {
    logError('Failed to update host collection settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getHostDockerRetentionSettings(
  ...args: [string] | [string, string]
): Promise<HostDockerRetentionSettings> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  await requireInstanceAccess(currentScope)

  const [host, instance] = await Promise.all([
    db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
      columns: { metadata: true },
    }),
    db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, currentScope),
      columns: { dockerMetricRetentionDays: true },
    }),
  ])

  const metadata = parseHostMetadata(host?.metadata)
  const globalRetentionDays = instance?.dockerMetricRetentionDays ?? 30
  const retentionDaysOverride = metadata.dockerSettings?.retentionDaysOverride ?? null

  return {
    globalRetentionDays,
    retentionDaysOverride,
    effectiveRetentionDays: retentionDaysOverride ?? globalRetentionDays,
  }
}

export async function updateHostDockerRetentionOverride(
  ...args: [string, number | null] | [string, string, number | null]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, hostId, days] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  await requireInstanceWriteAccess(currentScope)

  const parsed = hostDockerRetentionOverrideSchema.safeParse({ days })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid value' }
  }

  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope), isNull(hosts.deletedAt)),
      columns: { id: true, metadata: true },
    })
    if (!host) return { error: 'Host not found' }

    const currentMetadata = parseHostMetadata(host.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      dockerSettings: {
        ...(currentMetadata.dockerSettings ?? {}),
        retentionDaysOverride: parsed.data.days,
      },
    }

    await db
      .update(hosts)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(and(eq(hosts.id, hostId), eq(hosts.instanceId, currentScope)))

    return { success: true }
  } catch (err) {
    logError('Failed to update host Docker retention override:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getInstanceDefaultCollectionSettings(
  instanceId: string,
): Promise<HostCollectionSettings> {
  await requireInstanceAccess(instanceId)
  const instance = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })

  const meta = parseInstanceMetadata(instance?.metadata)
  if (meta?.defaultCollectionSettings) {
    return meta.defaultCollectionSettings
  }

  return { ...DEFAULT_COLLECTION_SETTINGS }
}

export async function updateInstanceDefaultCollectionSettings(
  instanceId: string,
  settings: HostCollectionSettings,
): Promise<{ success: true } | { error: string }> {
  await requireInstanceAdminAccess(instanceId)
  try {
    const instance = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { id: true, metadata: true },
    })
    if (!instance) return { error: 'Instance not found' }

    const currentMetadata = parseInstanceMetadata(instance.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      defaultCollectionSettings: settings,
    }

    await db
      .update(instanceSettings)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    return { success: true }
  } catch (err) {
    logError('Failed to update instance default collection settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

async function syncLocalUserChecks(
  instanceId: string,
  hostId: string,
  enabled: boolean,
): Promise<void> {
  // Find existing service_account and ssh_key_scan checks for this host
  const existingChecks = await db.query.checks.findMany({
    where: and(
      eq(checks.instanceId, instanceId),
      eq(checks.hostId, hostId),
      isNull(checks.deletedAt),
    ),
  })

  const serviceAccountCheck = existingChecks.find((c) => c.checkType === 'service_account')
  const sshKeyScanCheck = existingChecks.find((c) => c.checkType === 'ssh_key_scan')

  if (enabled) {
    // Create checks if they don't exist, or re-enable if disabled
    if (!serviceAccountCheck) {
      await createCheck(instanceId, {
        hostId,
        name: 'Local User Discovery',
        checkType: 'service_account',
        config: {},
        intervalSeconds: 300,
      })
    } else if (!serviceAccountCheck.enabled) {
      await updateCheck(instanceId, serviceAccountCheck.id, { enabled: true })
    }

    if (!sshKeyScanCheck) {
      await createCheck(instanceId, {
        hostId,
        name: 'SSH Key Scan',
        checkType: 'ssh_key_scan',
        config: {},
        intervalSeconds: 300,
      })
    } else if (!sshKeyScanCheck.enabled) {
      await updateCheck(instanceId, sshKeyScanCheck.id, { enabled: true })
    }
  } else {
    // Disable checks (don't delete — preserve history)
    if (serviceAccountCheck?.enabled) {
      await updateCheck(instanceId, serviceAccountCheck.id, { enabled: false })
    }
    if (sshKeyScanCheck?.enabled) {
      await updateCheck(instanceId, sshKeyScanCheck.id, { enabled: false })
    }
  }
}
