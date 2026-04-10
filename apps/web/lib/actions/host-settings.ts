'use server'

import { db } from '@/lib/db'
import { hosts, organisations, checks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { HostCollectionSettings, HostMetadata } from '@/lib/db/schema'
import type { OrgMetadata } from '@/lib/db/schema'
import { DEFAULT_COLLECTION_SETTINGS } from '@/lib/db/schema'
import { createCheck, updateCheck } from '@/lib/actions/checks'

export async function getHostCollectionSettings(
  orgId: string,
  hostId: string,
): Promise<HostCollectionSettings> {
  const host = await db.query.hosts.findFirst({
    where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
    columns: { metadata: true },
  })

  if (host?.metadata?.collectionSettings) {
    return host.metadata.collectionSettings
  }

  // Fall back to org defaults
  return getOrgDefaultCollectionSettings(orgId)
}

export async function updateHostCollectionSettings(
  orgId: string,
  hostId: string,
  settings: HostCollectionSettings,
): Promise<{ success: true } | { error: string }> {
  try {
    const host = await db.query.hosts.findFirst({
      where: and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId), isNull(hosts.deletedAt)),
      columns: { id: true, metadata: true },
    })
    if (!host) return { error: 'Host not found' }

    const currentMetadata = (host.metadata ?? { disks: [], network_interfaces: [] }) as HostMetadata
    const updatedMetadata: HostMetadata = {
      ...currentMetadata,
      collectionSettings: settings,
    }

    await db
      .update(hosts)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(and(eq(hosts.id, hostId), eq(hosts.organisationId, orgId)))

    // Auto-manage service_account and ssh_key_scan checks based on localUsers toggle
    await syncLocalUserChecks(orgId, hostId, settings.localUsers)

    return { success: true }
  } catch (err) {
    console.error('Failed to update host collection settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getOrgDefaultCollectionSettings(
  orgId: string,
): Promise<HostCollectionSettings> {
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { metadata: true },
  })

  const meta = org?.metadata as OrgMetadata | null
  if (meta?.defaultCollectionSettings) {
    return meta.defaultCollectionSettings
  }

  return { ...DEFAULT_COLLECTION_SETTINGS }
}

export async function updateOrgDefaultCollectionSettings(
  orgId: string,
  settings: HostCollectionSettings,
): Promise<{ success: true } | { error: string }> {
  try {
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, metadata: true },
    })
    if (!org) return { error: 'Organisation not found' }

    const currentMetadata = (org.metadata ?? {}) as OrgMetadata
    const updatedMetadata: OrgMetadata = {
      ...currentMetadata,
      defaultCollectionSettings: settings,
    }

    await db
      .update(organisations)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(organisations.id, orgId))

    return { success: true }
  } catch (err) {
    console.error('Failed to update org default collection settings:', err)
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
