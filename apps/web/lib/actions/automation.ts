'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { requireInstanceAdminAccess } from '@/lib/actions/action-auth'
import { resolveCurrentActionScope } from '@/lib/actions/action-scope'
import { getRequiredSession } from '@/lib/auth/session'
import { writeAuditEvent } from '@/lib/audit/events'
import {
  checkAnsibleApiHealth,
  getAnsibleApiBaseUrl,
  getAnsibleModuleConnectionSummary,
  saveAnsibleModuleConnection,
} from '@/lib/automation/ansible-api'
import { validateSshPrivateKey } from '@/lib/automation/ansible-runner'
import {
  buildAutomationSettingsSnapshot,
  isAnsibleAutomationEnabled,
  nextAutomationMetadata,
  type AutomationStatus,
} from '@/lib/automation/settings-core'
import { encrypt } from '@/lib/crypto/encrypt'
import { db } from '@/lib/db'
import { ansibleCredentialProfiles, instanceSettings, parseInstanceMetadata } from '@/lib/db/schema'
import { FEATURE_FLAG_REGISTRY } from '@/lib/feature-flags'
import { logError } from '@/lib/logging'
import type { ModuleAuthMode, ModuleTlsMode } from '@/lib/db/schema'
import type { ModuleConnectionSummary } from '@/lib/modules/module-connections'

export interface AutomationSettingsResult {
  provider: 'none' | 'ansible'
  ansibleFeatureEnabled: boolean
  ansibleAdminConfigurable: boolean
  ansibleDescription: string
  status: AutomationStatus
  statusMessage: string
  ansibleVersion?: string
  ansibleConnection: ModuleConnectionSummary
}

export interface AnsibleCredentialProfileSummary {
  id: string
  name: string
  username: string
  createdAt: Date
  updatedAt: Date
}

export interface AnsibleAutomationAvailability {
  enabled: boolean
}

const credentialInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  username: z.string().trim().min(1, 'SSH username is required').max(120),
  privateKey: z.string().min(1, 'Private key is required').max(100_000),
})

const ansibleConnectionInputSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1, 'Connection name is required').max(120),
  baseUrl: z.string().trim().min(1, 'Ansible API URL is required').max(2048),
  authMode: z.enum(['none', 'service-token-hmac']),
  tokenId: z.string().trim().optional().nullable(),
  tokenSecret: z.string().optional().nullable(),
  tlsMode: z.enum(['public-ca', 'private-ca', 'pinned-certificate', 'insecure']),
  timeoutMs: z.number().int().min(1000).max(120_000).optional().nullable(),
})

function toCredentialSummary(row: typeof ansibleCredentialProfiles.$inferSelect): AnsibleCredentialProfileSummary {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
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
  const ansibleConnection = await getAnsibleModuleConnectionSummary(instanceId)

  if (!isAnsibleAutomationEnabled(snapshot)) {
    return {
      ...snapshot,
      ansibleConnection,
      ansibleDescription: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
      status: 'disabled',
      statusMessage: 'Ansible automation is disabled for this instance.',
    }
  }

  const health = await checkAnsibleApiHealth(instanceId)
  if (health) {
    return {
      ...snapshot,
      ansibleConnection,
      ansibleDescription: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
      status: 'healthy',
      statusMessage: 'Ansible automation API is healthy.',
      ansibleVersion: health.ansibleVersion,
    }
  }

  return {
    ...snapshot,
    ansibleConnection,
    ansibleDescription: FEATURE_FLAG_REGISTRY['automation.ansible'].description,
    status: 'unavailable',
    statusMessage: 'Ansible automation is enabled. Check the configured Ansible API URL, service-token settings, and service health.',
  }
}

export async function getAnsibleAutomationAvailability(): Promise<AnsibleAutomationAvailability> {
  const session = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(session)

  const row = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, instanceId),
    columns: { metadata: true },
  })
  const metadata = parseInstanceMetadata(row?.metadata)
  const snapshot = buildAutomationSettingsSnapshot(metadata)

  return { enabled: isAnsibleAutomationEnabled(snapshot) }
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
    const currentConnection = await getAnsibleModuleConnectionSummary(instanceId)

    await db
      .update(instanceSettings)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(instanceSettings.id, instanceId))

    await saveAnsibleModuleConnection(instanceId, {
      enabled: parsedEnabled,
      name: currentConnection.name,
      baseUrl: currentConnection.baseUrl || getAnsibleApiBaseUrl(),
      authMode: currentConnection.authMode,
      tokenId: currentConnection.tokenId,
      tlsMode: currentConnection.tlsMode,
      timeoutMs: currentConnection.timeoutMs,
    })

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

export async function updateAnsibleModuleConnectionSettings(
  input: unknown,
): Promise<{ success: true; connection: ModuleConnectionSummary } | { error: string }> {
  const parsed = ansibleConnectionInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') }

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
    const connection = await saveAnsibleModuleConnection(instanceId, {
      enabled: parsed.data.enabled,
      name: parsed.data.name,
      baseUrl: parsed.data.baseUrl,
      authMode: parsed.data.authMode as ModuleAuthMode,
      tokenId: parsed.data.tokenId,
      tokenSecret: parsed.data.tokenSecret,
      tlsMode: parsed.data.tlsMode as ModuleTlsMode,
      timeoutMs: parsed.data.timeoutMs,
    })

    await writeAuditEvent(db, {
      instanceId,
      actorUserId: session.user.id,
      action: 'automation.ansible.connection.updated',
      targetType: 'module_connection',
      targetId: connection.id,
      summary: `Updated Ansible module connection ${connection.name}`,
      metadata: {
        moduleType: 'ansible',
        baseUrl: connection.baseUrl,
        authMode: connection.authMode,
        tlsMode: connection.tlsMode,
        enabled: connection.enabled,
      },
    })

    return { success: true, connection }
  } catch (err) {
    logError('Failed to update Ansible module connection:', err)
    return { error: err instanceof Error ? err.message : 'Failed to update Ansible module connection' }
  }
}

export async function listAnsibleCredentialProfiles(): Promise<AnsibleCredentialProfileSummary[]> {
  const session = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(session)

  await requireInstanceAdminAccess(instanceId)

  const rows = await db.query.ansibleCredentialProfiles.findMany({
    where: and(
      eq(ansibleCredentialProfiles.instanceId, instanceId),
      isNull(ansibleCredentialProfiles.deletedAt),
    ),
    orderBy: (profiles, { asc }) => [asc(profiles.name)],
  })

  return rows.map(toCredentialSummary)
}

export async function createAnsibleCredentialProfile(
  input: unknown,
): Promise<{ success: true; profile: AnsibleCredentialProfileSummary } | { error: string }> {
  const session = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(session)

  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to manage Ansible credentials' }
  }

  const parsed = credentialInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') }
  if (!validateSshPrivateKey(parsed.data.privateKey)) return { error: 'Paste a valid SSH private key' }

  try {
    const [row] = await db
      .insert(ansibleCredentialProfiles)
      .values({
        instanceId,
        name: parsed.data.name,
        username: parsed.data.username,
        privateKeyEncrypted: encrypt(parsed.data.privateKey),
        createdBy: session.user.id,
      })
      .returning()

    if (!row) return { error: 'Failed to create credential profile' }

    await writeAuditEvent(db, {
      instanceId,
      actorUserId: session.user.id,
      action: 'automation.ansible.credential.created',
      targetType: 'ansible_credential_profile',
      targetId: row.id,
      summary: `Created Ansible credential profile ${row.name}`,
      metadata: { username: row.username },
    })

    return { success: true, profile: toCredentialSummary(row) }
  } catch (err) {
    logError('Failed to create Ansible credential profile:', err)
    return { error: 'Failed to create credential profile' }
  }
}

export async function deleteAnsibleCredentialProfile(id: string): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const instanceId = resolveCurrentActionScope(session)

  try {
    await requireInstanceAdminAccess(instanceId)
  } catch {
    return { error: 'You do not have permission to manage Ansible credentials' }
  }

  try {
    const [row] = await db
      .update(ansibleCredentialProfiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(ansibleCredentialProfiles.id, id),
          eq(ansibleCredentialProfiles.instanceId, instanceId),
          isNull(ansibleCredentialProfiles.deletedAt),
        ),
      )
      .returning()

    if (!row) return { error: 'Credential profile not found' }

    await writeAuditEvent(db, {
      instanceId,
      actorUserId: session.user.id,
      action: 'automation.ansible.credential.deleted',
      targetType: 'ansible_credential_profile',
      targetId: id,
      summary: `Deleted Ansible credential profile ${row.name}`,
      metadata: { username: row.username },
    })

    return { success: true }
  } catch (err) {
    logError('Failed to delete Ansible credential profile:', err)
    return { error: 'Failed to delete credential profile' }
  }
}
