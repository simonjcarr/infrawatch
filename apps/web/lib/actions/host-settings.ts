'use server'

import { logError } from '@/lib/logging'
import { requireOrgAccess, requireOrgAdminAccess, requireOrgWriteAccess } from '@/lib/actions/action-auth'
import { getRequiredSession } from '@/lib/auth/session'

import { db } from '@/lib/db'
import { hosts, organisations, checks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { HostCollectionSettings } from '@/lib/db/schema'
import { DEFAULT_COLLECTION_SETTINGS } from '@/lib/db/schema'
import { parseHostMetadata } from '@/lib/db/schema/hosts'
import { parseOrgMetadata } from '@/lib/db/schema/organisations'
import { resolveCurrentActionScope } from './action-scope'
import { createCheck, updateCheck } from '@/lib/actions/checks'

export async function getHostCollectionSettings(
  ...args: [string] | [string, string]
): Promise<HostCollectionSettings> {
  const session = await getRequiredSession()
  const [currentScope, hostId] =
    args.length === 2 ? args : [resolveCurrentActionScope(session), args[0]]
  await requireOrgAccess(currentScope)
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, currentScope), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })

  const metadata = parseHostMetadata(host?.metadata)
  if (metadata.collectionSettings) {
    return metadata.collectionSettings
  }

  // Fall back to org defaults
  return getOrgDefaultCollectionSettings(currentScope)
}

export async function updateHostCollectionSettings(
  ...args: [string, HostCollectionSettings] | [string, string, HostCollectionSettings]
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const [currentScope, hostId, settings] =
    args.length === 3 ? args : [resolveCurrentActionScope(session), args[0], args[1]]
  await requireOrgWriteAccess(currentScope)
  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.organisationId, currentScope), isNull(hosts.deletedAt)),
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
      .where(and(eq(hosts.id, hostId), eq(hosts.organisationId, currentScope)))

    // Auto-manage service_account and ssh_key_scan checks based on localUsers toggle
    await syncLocalUserChecks(currentScope, hostId, settings.localUsers)

    return { success: true }
  } catch (err) {
    logError('Failed to update host collection settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getOrgDefaultCollectionSettings(
  orgId: string,
): Promise<HostCollectionSettings> {
  await requireOrgAccess(orgId)
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })

  const meta = parseOrgMetadata(org?.metadata)
  if (meta?.defaultCollectionSettings) {
    return meta.defaultCollectionSettings
  }

  return { ...DEFAULT_COLLECTION_SETTINGS }
}

export async function updateOrgDefaultCollectionSettings(
  orgId: string,
  settings: HostCollectionSettings,
): Promise<{ success: true } | { error: string }> {
  await requireOrgAdminAccess(orgId)
  try {
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, metadata: true },
    })
    if (!org) return { error: 'Organisation not found' }

    const currentMetadata = parseOrgMetadata(org.metadata)
    const updatedMetadata = {
      ...currentMetadata,
      defaultCollectionSettings: settings,
    }

    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    return { success: true }
  } catch (err) {
    logError('Failed to update org default collection settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

async function syncLocalUserChecks(
  orgId: string,
  hostId: string,
  enabled: boolean,
): Promise<void> {
  // Find existing service_account and ssh_key_scan checks for this host
  const existingChecks = await db.query.checks.findMany({
    where: and(
      eq(checks.organisationId, orgId),
      eq(checks.hostId, hostId),
      isNull(checks.deletedAt),
    ),
  })

  const serviceAccountCheck = existingChecks.find((c) => c.checkType === 'service_account')
  const sshKeyScanCheck = existingChecks.find((c) => c.checkType === 'ssh_key_scan')

  if (enabled) {
    // Create checks if they don't exist, or re-enable if disabled
    if (!serviceAccountCheck) {
      await createCheck(orgId, {
        hostId,
        name: 'Local User Discovery',
        checkType: 'service_account',
        config: {},
        intervalSeconds: 300,
      })
    } else if (!serviceAccountCheck.enabled) {
      await updateCheck(orgId, serviceAccountCheck.id, { enabled: true })
    }

    if (!sshKeyScanCheck) {
      await createCheck(orgId, {
        hostId,
        name: 'SSH Key Scan',
        checkType: 'ssh_key_scan',
        config: {},
        intervalSeconds: 300,
      })
    } else if (!sshKeyScanCheck.enabled) {
      await updateCheck(orgId, sshKeyScanCheck.id, { enabled: true })
    }
  } else {
    // Disable checks (don't delete — preserve history)
    if (serviceAccountCheck?.enabled) {
      await updateCheck(orgId, serviceAccountCheck.id, { enabled: false })
    }
    if (sshKeyScanCheck?.enabled) {
      await updateCheck(orgId, sshKeyScanCheck.id, { enabled: false })
    }
  }
}
