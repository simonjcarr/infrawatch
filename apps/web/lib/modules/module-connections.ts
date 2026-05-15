import { and, eq, isNull } from 'drizzle-orm'

import { decrypt, encrypt } from '@/lib/crypto/encrypt'
import { db } from '@/lib/db'
import {
  moduleConnections,
  type ModuleConnection,
  type ModuleType,
} from '@/lib/db/schema'
import {
  normaliseModuleConnectionForSave as normaliseForSave,
  publicModuleConnectionSummary,
  type ModuleConnectionInput,
  type ModuleConnectionRuntime,
  type ModuleConnectionSummary,
} from './module-connections-core'

export {
  MODULE_CONTRACT_VERSION,
  normaliseModuleConnectionForSave,
  publicModuleConnectionSummary,
  type ModuleConnectionInput,
  type ModuleConnectionRuntime,
  type ModuleConnectionSummary,
} from './module-connections-core'

function runtimeModuleConnection(row: ModuleConnection): ModuleConnectionRuntime {
  return {
    ...publicModuleConnectionSummary(row),
    tokenSecret: row.tokenSecretEncrypted ? decrypt(row.tokenSecretEncrypted) : null,
  }
}

export async function getModuleConnectionSummary(
  instanceId: string,
  moduleType: ModuleType,
): Promise<ModuleConnectionSummary | null> {
  const row = await db.query.moduleConnections.findFirst({
    where: and(
      eq(moduleConnections.instanceId, instanceId),
      eq(moduleConnections.moduleType, moduleType),
      isNull(moduleConnections.deletedAt),
    ),
  })
  return row ? publicModuleConnectionSummary(row) : null
}

export async function getModuleConnectionRuntime(
  instanceId: string,
  moduleType: ModuleType,
): Promise<ModuleConnectionRuntime | null> {
  const row = await db.query.moduleConnections.findFirst({
    where: and(
      eq(moduleConnections.instanceId, instanceId),
      eq(moduleConnections.moduleType, moduleType),
      isNull(moduleConnections.deletedAt),
    ),
  })
  return row ? runtimeModuleConnection(row) : null
}

export async function saveModuleConnection(
  instanceId: string,
  input: ModuleConnectionInput,
): Promise<ModuleConnectionSummary> {
  const existing = await db.query.moduleConnections.findFirst({
    where: and(
      eq(moduleConnections.instanceId, instanceId),
      eq(moduleConnections.moduleType, input.moduleType),
      isNull(moduleConnections.deletedAt),
    ),
  })
  const now = new Date()
  const values = normaliseForSave({ instanceId, input, existing, encryptSecret: encrypt })

  const [row] = await db
    .insert(moduleConnections)
    .values({
      ...values,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [moduleConnections.instanceId, moduleConnections.moduleType],
      set: {
        enabled: values.enabled,
        name: values.name,
        baseUrl: values.baseUrl,
        contractVersion: values.contractVersion,
        authMode: values.authMode,
        tokenId: values.tokenId,
        tokenSecretEncrypted: values.tokenSecretEncrypted,
        tlsMode: values.tlsMode,
        caCertificate: values.caCertificate,
        serverCertificateSha256: values.serverCertificateSha256,
        timeoutMs: values.timeoutMs,
        deletedAt: null,
        updatedAt: now,
      },
    })
    .returning()

  if (!row) throw new Error('Failed to save module connection')
  return publicModuleConnectionSummary(row)
}
