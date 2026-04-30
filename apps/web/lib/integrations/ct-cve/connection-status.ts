import { eq } from 'drizzle-orm'

import type { Database } from '../../db/index.ts'
import { systemConfig } from '../../db/schema/index.ts'

export interface CtCveConnectionStatus {
  contractVersion: '2026-04-30'
  orgId: string
  configured: boolean
  enabled: boolean
  lastInventoryPushAt: string | null
  lastFindingIngestAt: string | null
  lastHealthCheckAt: string | null
  lastErrorCode: string | null
  lastErrorAt: string | null
}

export interface CtCveConnectionStatusRepository {
  get(orgId: string): Promise<CtCveConnectionStatus | null>
  save(status: CtCveConnectionStatus): Promise<void>
}

const CONTRACT_VERSION = '2026-04-30'
const CONFIG_KEY_PREFIX = 'ct_cve_connection_status:'

function configKey(orgId: string) {
  return `${CONFIG_KEY_PREFIX}${orgId}`
}

function emptyStatus(orgId: string, configured = true): CtCveConnectionStatus {
  return {
    contractVersion: CONTRACT_VERSION,
    orgId,
    configured,
    enabled: true,
    lastInventoryPushAt: null,
    lastFindingIngestAt: null,
    lastHealthCheckAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
  }
}

function parseStoredStatus(orgId: string, value: string): CtCveConnectionStatus | null {
  try {
    const parsed = JSON.parse(value) as Partial<CtCveConnectionStatus>
    if (!parsed || parsed.contractVersion !== CONTRACT_VERSION || parsed.orgId !== orgId) {
      return null
    }

    return {
      ...emptyStatus(orgId, parsed.configured ?? true),
      ...parsed,
      contractVersion: CONTRACT_VERSION,
      orgId,
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
  orgId: string,
  options: { configured?: boolean; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const stored = await repo.get(orgId)
  return {
    ...(stored ?? emptyStatus(orgId, options.configured ?? true)),
    configured: options.configured ?? stored?.configured ?? true,
  }
}

export async function recordCtCveConnectionHealth(
  orgId: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(orgId, { repository: repo })
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
  orgId: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(orgId, { repository: repo })
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
  orgId: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(orgId, { repository: repo })
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
  orgId: string,
  errorCode: string,
  options: { now?: Date; repository?: CtCveConnectionStatusRepository } = {},
): Promise<CtCveConnectionStatus> {
  const repo = await repository(options)
  const current = await getCtCveConnectionStatus(orgId, { repository: repo })
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
    async get(orgId) {
      const row = await database.query.systemConfig.findFirst({
        where: eq(systemConfig.key, configKey(orgId)),
        columns: { value: true },
      })
      return row ? parseStoredStatus(orgId, row.value) : null
    },
    async save(status) {
      await database
        .insert(systemConfig)
        .values({
          key: configKey(status.orgId),
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
