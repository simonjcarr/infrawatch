import { eq } from 'drizzle-orm'

import type { Database } from '../../db/index.ts'
import { systemConfig } from '../../db/schema/index.ts'

export interface CtCveConnectionStatus {
  contractVersion: '2026-04-30'
  instanceId: string
  configured: boolean
  enabled: boolean
  lastInventoryPushAt: string | null
  lastFindingIngestAt: string | null
  lastHealthCheckAt: string | null
  lastErrorCode: string | null
  lastErrorAt: string | null
}

export interface CtCveConnectionStatusRepository {
  get(instanceId: string): Promise<CtCveConnectionStatus | null>
  save(status: CtCveConnectionStatus): Promise<void>
}

const CONTRACT_VERSION = '2026-04-30'
const CONFIG_KEY_PREFIX = 'ct_cve_connection_status:'

function configKey(instanceId: string) {
  return `${CONFIG_KEY_PREFIX}${instanceId}`
}

function emptyStatus(instanceId: string, configured = true): CtCveConnectionStatus {
  return {
    contractVersion: CONTRACT_VERSION,
    instanceId,
    configured,
    enabled: true,
    lastInventoryPushAt: null,
    lastFindingIngestAt: null,
    lastHealthCheckAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
  }
}

function parseStoredStatus(instanceId: string, value: string): CtCveConnectionStatus | null {
  try {
    const parsed = JSON.parse(value) as Partial<CtCveConnectionStatus>
    if (!parsed || parsed.contractVersion !== CONTRACT_VERSION || parsed.instanceId !== instanceId) {
      return null
    }

    return {
      ...emptyStatus(instanceId, parsed.configured ?? true),
      ...parsed,
      contractVersion: CONTRACT_VERSION,
      instanceId,
      configured: parsed.configured ?? true,
      enabled: parsed.enabled ?? true,
    }
  } catch {
    return null
  }
}

function iso(value: Date) {
  return value.toISOString()
}

async function repository(options?: { repository?: CtCveConnectionStatusRepository }) {
  return options?.repository ?? await getDefaultRepository()
}

export async function getCtCveConnectionStatus(
  instanceId: string,
  options: { configured?: boolean; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const stored = await repo.get(instanceId)
  return {
    ...(stored ?? emptyStatus(instanceId, options.configured ?? true)),
    configured: options.configured ?? stored?.configured ?? true,
  }
}

export async function recordCtCveConnectionHealth(
  instanceId: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(instanceId, { repository: repo })
  const next = {
    ...current,
    configured: true,
    enabled: true,
    lastHealthCheckAt: iso(options.now ?? new Date()),
  }
  await repo.save(next)
  return next
}

export async function recordCtCveFindingIngest(
  instanceId: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(instanceId, { repository: repo })
  const next = {
    ...current,
    configured: true,
    enabled: true,
    lastFindingIngestAt: iso(options.now ?? new Date()),
    lastErrorCode: null,
    lastErrorAt: null,
  }
  await repo.save(next)
  return next
}

export async function recordCtCveInventoryPush(
  instanceId: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(instanceId, { repository: repo })
  const next = {
    ...current,
    configured: true,
    enabled: true,
    lastInventoryPushAt: iso(options.now ?? new Date()),
    lastErrorCode: null,
    lastErrorAt: null,
  }
  await repo.save(next)
  return next
}

export async function recordCtCveConnectionError(
  instanceId: string,
  errorCode: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(instanceId, { repository: repo })
  const next = {
    ...current,
    configured: true,
    enabled: true,
    lastErrorCode: errorCode,
    lastErrorAt: iso(options.now ?? new Date()),
  }
  await repo.save(next)
  return next
}

async function getDefaultRepository(): Promise<CtCveConnectionStatusRepository> {
  const { db: database } = await import('../../db/index.ts')
  return createSystemConfigCtCveConnectionStatusRepository(database)
}

export function createSystemConfigCtCveConnectionStatusRepository(database: Database): CtCveConnectionStatusRepository {
  return {
    async get(instanceId) {
      const row = await database.query.systemConfig.findFirst({
        where: eq(systemConfig.key, configKey(instanceId)),
        columns: { value: true },
      })
      return row ? parseStoredStatus(instanceId, row.value) : null
    },
    async save(status) {
      await database
        .insert(systemConfig)
        .values({
          key: configKey(status.instanceId),
          value: JSON.stringify(status),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: {
            value: JSON.stringify(status),
            updatedAt: new Date(),
          },
        })
    },
  }
}
