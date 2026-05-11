'use server'

import { eq } from 'drizzle-orm'

import { requireInstanceAdminAccess } from '@/lib/actions/action-auth'
import { resolveCurrentActionScope } from '@/lib/actions/action-scope'
import { getRequiredSession } from '@/lib/auth/session'
import { writeAuditEvent } from '@/lib/audit/events'
import { checkAnsibleApiHealth } from '@/lib/automation/ansible-api'
import {
  buildAutomationSettingsSnapshot,
  nextAutomationMetadata,
  type AutomationStatus,
} from '@/lib/automation/settings-core'
import { db } from '@/lib/db'
import { instanceSettings, parseInstanceMetadata } from '@/lib/db/schema'
import { FEATURE_FLAG_REGISTRY } from '@/lib/feature-flags'
import { logError } from '@/lib/logging'

export interface AutomationSettingsResult {
  provider: 'none' | 'ansible'
  ansibleFeatureEnabled: boolean
  ansibleAdminConfigurable: boolean
  ansibleDescription: string
  status: AutomationStatus
  statusMessage: string
  ansibleVersion?: string
}

export async function getAutomationSettings(): Promise<AutomationSettingsResult> {
  const session = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(session)

  const row = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  const metadata = parseInstanceMetadata(row?.metadata)
  const snapshot = buildAutomationSettingsSnapshot(metadata)

  if (!snapshot.ansibleFeatureEnabled || snapshot.provider !== 'ansible') {
    return {
      ...snapshot,
      ansibleDescription: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
      status: 'disabled',
      statusMessage: 'Ansible automation is disabled for this instance.',
    }
  }

  const health = await checkAnsibleApiHealth()
  if (health) {
    return {
      ...snapshot,
      ansibleDescription: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
      status: 'healthy',
      statusMessage: 'Ansible automation API is healthy.',
      ansibleVersion: health.ansibleVersion,
    }
  }

  return {
    ...snapshot,
    ansibleDescription: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
    status: 'unavailable',
    statusMessage: 'Ansible automation is enabled. Run ./start.sh on the host to start the optional Ansible service.',
  }
}

export async function updateAnsibleAutomationSettings(
  enabled: boolean,
): Promise<{ success: true } | { error: string }> {
  const parsedEnabled = typeof enabled === 'boolean' ? enabled : null
  if (parsedEnabled === null) return { error: 'Invalid Ansible automation setting' }

  let session
  let instanceId
  try {
    session = await getRequiredSession()
    instanceId = resolveCurrentActionScope(session)
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to update automation settings' }
  }

  try {
    const row = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, instanceId),
      columns: { metadata: true },
    })
    if (!row) return { error: 'Instance not found' }

    const currentMetadata = parseInstanceMetadata(row.metadata)
    const next = nextAutomationMetadata({
      featureFlags: currentMetadata.featureFlags,
      enableAnsible: parsedEnabled,
    })
    const metadata = {
      ...currentMetadata,
      ...next,
    }

    await db
      .update(instanceSettings)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    await writeAuditEvent(db, {
      instanceId,
      actorUserId: session.user.id,
      action: 'automation.ansible.updated',
      targetType: 'instance',
      targetId: instanceId,
      summary: parsedEnabled ? 'Enabled Ansible automation' : 'Disabled Ansible automation',
      metadata: {
        provider: metadata.automationSettings.provider,
        featureEnabled: metadata.featureFlags['automation.ansible'] === true,
      },
    })

    return { success: true }
  } catch (err) {
    logError('Failed to update Ansible automation settings:', err)
    return { error: 'An unexpected error occurred' }
  }
}
