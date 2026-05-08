import {
  buildCtCveInventorySnapshot,
  pushCtCveInventorySnapshot,
  type CtCveInventoryPushResult,
  type CtCveInventorySnapshot,
} from './inventory-export.ts'
import type { CtCveConnectionStatusRepository } from './connection-status.ts'
import { listCtCveInventoryPushTargetsFromSettings } from './connector-settings.ts'

export interface CtCveInventoryPushTarget {
  name: string
  enabled: boolean
  baseUrl: string
  token: {
    id: string
    secret: string
    orgId: string
    scopes: string[]
  }
}

export interface CtCveInventoryPushJobResult {
  targetsConfigured: number
  targetsPushed: number
  snapshotsPushed: number
  hostsAccepted: number
  packagesAccepted: number
  rowsRejected: number
  failures: Array<{
    target: string
    message: string
  }>
}

interface BuildSnapshotOptions {
  orgId: string
  cursor?: string
  snapshotType: 'full'
}

type BuildSnapshot = (options: BuildSnapshotOptions) => Promise<CtCveInventorySnapshot>
type LoadTargets = (env?: NodeJS.ProcessEnv) => Promise<CtCveInventoryPushTarget[]>
type PushSnapshot = (options: {
  baseUrl: string
  token: CtCveInventoryPushTarget['token']
  snapshot: CtCveInventorySnapshot
  statusRepository?: CtCveConnectionStatusRepository
}) => Promise<CtCveInventoryPushResult>

const DEFAULT_MAX_PAGES_PER_TARGET = 1_000
const SECRET_MIN_BYTES = 32

function normaliseBaseUrl(value: string, path: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${path}.baseUrl must be an absolute http(s) URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${path}.baseUrl must be an absolute http(s) URL`)
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function secretHasEnoughEntropy(value: string): boolean {
  if (Buffer.byteLength(value, 'utf8') >= SECRET_MIN_BYTES) {
    return true
  }
  try {
    return Buffer.from(value, 'base64url').byteLength >= SECRET_MIN_BYTES
  } catch {
    return false
  }
}

export function parseCtCveInventoryPushTargets(value: string | undefined): CtCveInventoryPushTarget[] {
  if (!value?.trim()) {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('CT_CVE_INVENTORY_PUSH_TARGETS must be valid JSON')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('CT_CVE_INVENTORY_PUSH_TARGETS must be a JSON array')
  }

  const targets = parsed.map((entry, index) => {
    const path = `CT_CVE_INVENTORY_PUSH_TARGETS[${index}]`
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${path} must be an object`)
    }

    const record = entry as Record<string, unknown>
    const token = record.token
    if (!token || typeof token !== 'object') {
      throw new Error(`${path}.token must be an object`)
    }
    const tokenRecord = token as Record<string, unknown>
    const scopes = Array.isArray(tokenRecord.scopes)
      ? tokenRecord.scopes.filter((scope): scope is string => typeof scope === 'string')
      : []

    if (
      typeof record.name !== 'string' ||
      !record.name.trim() ||
      typeof record.baseUrl !== 'string' ||
      typeof tokenRecord.id !== 'string' ||
      !tokenRecord.id.trim() ||
      typeof tokenRecord.secret !== 'string' ||
      typeof tokenRecord.orgId !== 'string' ||
      !tokenRecord.orgId.trim()
    ) {
      throw new Error(`${path} is missing name, baseUrl, token.id, token.secret, or token.orgId`)
    }
    if (!secretHasEnoughEntropy(tokenRecord.secret)) {
      throw new Error(`${path}.token.secret must contain at least 32 bytes of entropy`)
    }
    if (!scopes.includes('inventory:write')) {
      throw new Error(`${path}.token.scopes must include inventory:write`)
    }

    return {
      name: record.name.trim(),
      enabled: record.enabled !== false,
      baseUrl: normaliseBaseUrl(record.baseUrl, path),
      token: {
        id: tokenRecord.id.trim(),
        secret: tokenRecord.secret,
        orgId: tokenRecord.orgId.trim(),
        scopes,
      },
    }
  })

  return targets.filter((target) => target.enabled)
}

export function getConfiguredCtCveInventoryPushTargets(
  env: NodeJS.ProcessEnv = process.env,
): CtCveInventoryPushTarget[] {
  return parseCtCveInventoryPushTargets(env.CT_CVE_INVENTORY_PUSH_TARGETS)
}

async function getCtCveInventoryPushTargetsForJob(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CtCveInventoryPushTarget[]> {
  const stored = await listCtCveInventoryPushTargetsFromSettings()
  if (stored.settingsCount > 0) {
    return stored.targets
  }
  return getConfiguredCtCveInventoryPushTargets(env)
}

export async function runCtCveInventoryPushes(options: {
  targets?: CtCveInventoryPushTarget[]
  env?: NodeJS.ProcessEnv
  loadTargets?: LoadTargets
  buildSnapshot?: BuildSnapshot
  pushSnapshot?: PushSnapshot
  statusRepository?: CtCveConnectionStatusRepository
  maxPagesPerTarget?: number
} = {}): Promise<CtCveInventoryPushJobResult> {
  const loadTargets = options.loadTargets ?? getCtCveInventoryPushTargetsForJob
  const targets = options.targets ?? await loadTargets(options.env)
  const buildSnapshot = options.buildSnapshot ?? ((snapshotOptions) => buildCtCveInventorySnapshot(snapshotOptions))
  const pushSnapshot = options.pushSnapshot ?? pushCtCveInventorySnapshot
  const maxPagesPerTarget = Math.max(1, options.maxPagesPerTarget ?? DEFAULT_MAX_PAGES_PER_TARGET)
  const result: CtCveInventoryPushJobResult = {
    targetsConfigured: targets.length,
    targetsPushed: 0,
    snapshotsPushed: 0,
    hostsAccepted: 0,
    packagesAccepted: 0,
    rowsRejected: 0,
    failures: [],
  }

  for (const target of targets) {
    let cursor: string | undefined
    let page = 0
    let pushedForTarget = false

    try {
      do {
        if (page >= maxPagesPerTarget) {
          throw new Error(`CT-CVE inventory push exceeded ${maxPagesPerTarget} pages for target ${target.name}`)
        }

        const snapshot = await buildSnapshot({
          orgId: target.token.orgId,
          cursor,
          snapshotType: 'full',
        })
        const pushed = await pushSnapshot({
          baseUrl: target.baseUrl,
          token: target.token,
          snapshot,
          statusRepository: options.statusRepository,
        })
        result.snapshotsPushed += 1
        result.hostsAccepted += pushed.hostsAccepted
        result.packagesAccepted += pushed.packagesAccepted
        result.rowsRejected += pushed.rowsRejected
        pushedForTarget = true
        cursor = snapshot.cursor ?? undefined
        page += 1
      } while (cursor)

      if (pushedForTarget) {
        result.targetsPushed += 1
      }
    } catch (error) {
      result.failures.push({
        target: target.name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
