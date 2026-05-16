import type {
  ModuleAuthMode,
  ModuleConnection,
  ModuleTlsMode,
  ModuleType,
  NewModuleConnection,
} from '@/lib/db/schema/module-connections'
import { normaliseModuleBaseUrl, normaliseModuleTokenId } from './service-token.ts'

export const MODULE_CONTRACT_VERSION = '2026-05-15'

const SECRET_MIN_BYTES = 32
const DEFAULT_TIMEOUT_MS = 5000
const MAX_TIMEOUT_MS = 120_000

export interface ModuleConnectionInput {
  moduleType: ModuleType
  enabled: boolean
  name: string
  baseUrl: string
  authMode?: ModuleAuthMode
  tokenId?: string | null
  tokenSecret?: string | null
  tlsMode?: ModuleTlsMode
  caCertificate?: string | null
  serverCertificateSha256?: string | null
  timeoutMs?: number | null
}

export interface ModuleConnectionSummary {
  id: string
  instanceId: string
  moduleType: ModuleType
  enabled: boolean
  name: string
  baseUrl: string
  contractVersion: string
  authMode: ModuleAuthMode
  tokenId: string | null
  hasTokenSecret: boolean
  tlsMode: ModuleTlsMode
  caCertificate: string | null
  serverCertificateSha256: string | null
  timeoutMs: number
  createdAt: Date
  updatedAt: Date
}

export interface ModuleConnectionRuntime extends ModuleConnectionSummary {
  tokenSecret: string | null
}

function normaliseName(value: string, moduleType: ModuleType): string {
  const name = value.trim() || (moduleType === 'ansible' ? 'Primary Ansible API' : 'Primary CT-CVE')
  if (name.length > 120) throw new Error('Module connection name must be 120 characters or fewer')
  return name
}

function normaliseAuthMode(value: ModuleAuthMode | undefined): ModuleAuthMode {
  return value === 'none' ? 'none' : 'service-token-hmac'
}

function normaliseTlsMode(value: ModuleTlsMode | undefined): ModuleTlsMode {
  if (value === 'private-ca' || value === 'pinned-certificate' || value === 'insecure') return value
  return 'public-ca'
}

function normaliseTimeoutMs(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.trunc(value), 1000), MAX_TIMEOUT_MS)
}

function secretHasEnoughEntropy(value: string): boolean {
  return Buffer.byteLength(value, 'utf8') >= SECRET_MIN_BYTES
}

function encryptedTokenSecret(options: {
  authMode: ModuleAuthMode
  tokenSecret?: string | null
  existingEncrypted?: string | null
  encryptSecret: (value: string) => string
}): string | null {
  if (options.authMode === 'none') return null

  const provided = options.tokenSecret?.trim() ?? ''
  if (!provided && options.existingEncrypted) return options.existingEncrypted
  if (!provided) throw new Error('Module token secret is required for HMAC authentication')
  if (!secretHasEnoughEntropy(provided)) {
    throw new Error(`Module token secret must contain at least ${SECRET_MIN_BYTES} bytes of entropy`)
  }
  return options.encryptSecret(provided)
}

export function normaliseModuleConnectionForSave(options: {
  instanceId: string
  input: ModuleConnectionInput
  existing?: Pick<ModuleConnection, 'tokenSecretEncrypted'> | null
  encryptSecret: (value: string) => string
}): NewModuleConnection {
  const instanceId = options.instanceId.trim()
  if (!instanceId) throw new Error('Instance ID is required')

  const authMode = normaliseAuthMode(options.input.authMode)
  const tlsMode = normaliseTlsMode(options.input.tlsMode)
  const baseUrl = normaliseModuleBaseUrl(options.input.baseUrl)
  if (new URL(baseUrl).protocol === 'http:' && tlsMode !== 'insecure') {
    throw new Error('HTTP module URLs require the insecure TLS mode')
  }
  const tokenId = authMode === 'service-token-hmac'
    ? normaliseModuleTokenId(options.input.tokenId ?? '')
    : null

  return {
    instanceId,
    moduleType: options.input.moduleType,
    enabled: options.input.enabled,
    name: normaliseName(options.input.name, options.input.moduleType),
    baseUrl,
    contractVersion: MODULE_CONTRACT_VERSION,
    authMode,
    tokenId,
    tokenSecretEncrypted: encryptedTokenSecret({
      authMode,
      tokenSecret: options.input.tokenSecret,
      existingEncrypted: options.existing?.tokenSecretEncrypted,
      encryptSecret: options.encryptSecret,
    }),
    tlsMode,
    caCertificate: options.input.caCertificate?.trim() || null,
    serverCertificateSha256: options.input.serverCertificateSha256?.trim() || null,
    timeoutMs: normaliseTimeoutMs(options.input.timeoutMs),
  }
}

export function publicModuleConnectionSummary(row: ModuleConnection): ModuleConnectionSummary {
  return {
    id: row.id,
    instanceId: row.instanceId,
    moduleType: row.moduleType,
    enabled: row.enabled,
    name: row.name,
    baseUrl: row.baseUrl,
    contractVersion: row.contractVersion,
    authMode: row.authMode,
    tokenId: row.tokenId,
    hasTokenSecret: Boolean(row.tokenSecretEncrypted),
    tlsMode: row.tlsMode,
    caCertificate: row.caCertificate,
    serverCertificateSha256: row.serverCertificateSha256,
    timeoutMs: row.timeoutMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
