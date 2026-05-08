import { randomBytes } from 'node:crypto'
import { asc, eq, isNull } from 'drizzle-orm'

import {
  ctCveConnectorSettings,
  organisations,
  type CtCveConnectorSettings,
  type NewCtCveConnectorSettings,
} from '../../db/schema/index.ts'
import { decrypt, encrypt } from '../../crypto/encrypt.ts'
import {
  parseCtCveServiceTokens,
  type CtCveServiceToken,
} from './service-token.ts'
import type { CtCveInventoryPushTarget } from './inventory-push-job.ts'

export const CT_CVE_CONNECTOR_CONTRACT_VERSION = '2026-04-30'
export const DEFAULT_CT_CVE_CONNECTOR_NAME = 'Primary CT-CVE'

const SECRET_MIN_BYTES = 32
const TOKEN_ID_RE = /^[A-Za-z0-9._:-]{3,128}$/

export interface CtCveConnectorSettingsInput {
  enabled: boolean
  name: string
  baseUrl: string
  inventoryTokenId: string
  inventoryTokenSecret?: string | null
  ctCveTokenId: string
  ctCveTokenSecret?: string | null
}

export interface CtCveConnectorExistingSecrets {
  inventoryTokenSecretEncrypted?: string | null
  ctCveTokenSecretEncrypted?: string | null
}

export interface CtCveConnectorSettingsSummary {
  organisationId: string
  enabled: boolean
  name: string
  baseUrl: string
  inventoryTokenId: string
  ctCveTokenId: string
  hasInventoryTokenSecret: boolean
  hasCtCveTokenSecret: boolean
  createdAt?: Date
  updatedAt?: Date
}

export interface CtCveConnectorSettingsFull {
  organisationId: string
  enabled: boolean
  name: string
  baseUrl: string
  inventoryTokenId: string
  inventoryTokenSecret: string
  ctCveTokenId: string
  ctCveTokenSecret: string
  createdAt?: Date
  updatedAt?: Date
}

export interface CtCveConnectorSettingsRepository {
  getSummary(orgId: string): Promise<CtCveConnectorSettingsSummary | null>
}

export interface CtCveCtOpsConnectionConfig {
  name: string
  orgId: string
  ctOpsBaseUrl: string
  inventoryTokens: Array<{
    id: string
    secret: string
    scopes: Array<'inventory:write' | 'connection:read'>
  }>
  ctOpsToken: {
    id: string
    secret: string
    scopes: Array<'findings:write' | 'connection:read'>
  }
}

interface NormaliseForSaveOptions {
  orgId: string
  input: CtCveConnectorSettingsInput
  existing?: CtCveConnectorExistingSecrets | null
  generateSecret?: () => string
  encryptSecret?: (value: string) => string
}

export function defaultCtCveConnectorTokenId(prefix: string, orgId: string): string {
  const suffix = orgId.replace(/[^A-Za-z0-9._:-]/g, '_').replace(/^_+|_+$/g, '') || 'org'
  return `${prefix}_${suffix}`.slice(0, 128)
}

export function generateCtCveServiceTokenSecret(): string {
  return randomBytes(SECRET_MIN_BYTES).toString('base64url')
}

export function normaliseCtCveBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('CT-CVE base URL must be an absolute http(s) URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('CT-CVE base URL must be an absolute http(s) URL')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function normaliseCtOpsBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('CT Ops base URL must be an absolute http(s) URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('CT Ops base URL must be an absolute http(s) URL')
  }
  return url.origin
}

function normaliseName(value: string): string {
  const name = value.trim() || DEFAULT_CT_CVE_CONNECTOR_NAME
  if (name.length > 120) {
    throw new Error('Connector name must be 120 characters or fewer')
  }
  return name
}

function normaliseTokenId(value: string, label: string): string {
  const tokenId = value.trim()
  if (!TOKEN_ID_RE.test(tokenId)) {
    throw new Error(`${label} must be 3-128 characters and contain only letters, numbers, dots, underscores, colons, or dashes`)
  }
  return tokenId
}

function secretHasEnoughEntropy(value: string): boolean {
  return Buffer.byteLength(value, 'utf8') >= SECRET_MIN_BYTES
}

function encryptedSecretForSave(options: {
  value: string | null | undefined
  existingEncrypted?: string | null
  label: string
  generateSecret: () => string
  encryptSecret: (value: string) => string
}) {
  const provided = options.value?.trim() ?? ''
  if (!provided && options.existingEncrypted) {
    return options.existingEncrypted
  }

  const secret = provided || options.generateSecret()
  if (!secretHasEnoughEntropy(secret)) {
    throw new Error(`${options.label} must contain at least ${SECRET_MIN_BYTES} bytes of entropy`)
  }
  return options.encryptSecret(secret)
}

export function normaliseCtCveConnectorSettingsForSave({
  orgId,
  input,
  existing,
  generateSecret = generateCtCveServiceTokenSecret,
  encryptSecret = encrypt,
}: NormaliseForSaveOptions): NewCtCveConnectorSettings {
  const organisationId = orgId.trim()
  if (!organisationId) {
    throw new Error('Organisation ID is required')
  }

  return {
    organisationId,
    enabled: input.enabled,
    name: normaliseName(input.name),
    baseUrl: normaliseCtCveBaseUrl(input.baseUrl),
    inventoryTokenId: normaliseTokenId(input.inventoryTokenId, 'Inventory token ID'),
    inventoryTokenSecretEncrypted: encryptedSecretForSave({
      value: input.inventoryTokenSecret,
      existingEncrypted: existing?.inventoryTokenSecretEncrypted,
      label: 'Inventory token secret',
      generateSecret,
      encryptSecret,
    }),
    ctCveTokenId: normaliseTokenId(input.ctCveTokenId, 'CT-CVE token ID'),
    ctCveTokenSecretEncrypted: encryptedSecretForSave({
      value: input.ctCveTokenSecret,
      existingEncrypted: existing?.ctCveTokenSecretEncrypted,
      label: 'CT-CVE token secret',
      generateSecret,
      encryptSecret,
    }),
  }
}

function rowToSummary(row: CtCveConnectorSettings): CtCveConnectorSettingsSummary {
  return {
    organisationId: row.organisationId,
    enabled: row.enabled,
    name: row.name,
    baseUrl: row.baseUrl,
    inventoryTokenId: row.inventoryTokenId,
    ctCveTokenId: row.ctCveTokenId,
    hasInventoryTokenSecret: Boolean(row.inventoryTokenSecretEncrypted),
    hasCtCveTokenSecret: Boolean(row.ctCveTokenSecretEncrypted),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function rowToFull(row: CtCveConnectorSettings): CtCveConnectorSettingsFull {
  return {
    organisationId: row.organisationId,
    enabled: row.enabled,
    name: row.name,
    baseUrl: row.baseUrl,
    inventoryTokenId: row.inventoryTokenId,
    inventoryTokenSecret: decrypt(row.inventoryTokenSecretEncrypted),
    ctCveTokenId: row.ctCveTokenId,
    ctCveTokenSecret: decrypt(row.ctCveTokenSecretEncrypted),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function getConnectorRowForOrg(orgId: string): Promise<CtCveConnectorSettings | null> {
  const { withOrgDatabaseScope } = await import('../../db/index.ts')
  return withOrgDatabaseScope(orgId, async (scopedDb) => {
    const row = await scopedDb.query.ctCveConnectorSettings.findFirst({
      where: eq(ctCveConnectorSettings.organisationId, orgId),
    })
    return row ?? null
  })
}

async function listConnectorRowsAcrossOrganisations(): Promise<CtCveConnectorSettings[]> {
  const { db } = await import('../../db/index.ts')
  const orgs = await db.query.organisations.findMany({
    where: isNull(organisations.deletedAt),
    columns: { id: true },
    orderBy: [asc(organisations.id)],
  })

  const rows: CtCveConnectorSettings[] = []
  for (const org of orgs) {
    const row = await getConnectorRowForOrg(org.id)
    if (row) rows.push(row)
  }
  return rows
}

export async function getCtCveConnectorSettingsSummary(
  orgId: string,
): Promise<CtCveConnectorSettingsSummary | null> {
  const row = await getConnectorRowForOrg(orgId)
  return row ? rowToSummary(row) : null
}

export async function getCtCveConnectorSettingsForAdmin(
  orgId: string,
): Promise<CtCveConnectorSettingsFull | null> {
  const row = await getConnectorRowForOrg(orgId)
  return row ? rowToFull(row) : null
}

export async function saveCtCveConnectorSettings(
  orgId: string,
  input: CtCveConnectorSettingsInput,
): Promise<CtCveConnectorSettingsFull> {
  const existing = await getConnectorRowForOrg(orgId)
  const now = new Date()
  const values = normaliseCtCveConnectorSettingsForSave({
    orgId,
    input,
    existing,
  })

  const { withOrgDatabaseScope } = await import('../../db/index.ts')
  await withOrgDatabaseScope(orgId, async (scopedDb) => {
    await scopedDb
      .insert(ctCveConnectorSettings)
      .values({
        ...values,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ctCveConnectorSettings.organisationId,
        set: {
          enabled: values.enabled,
          name: values.name,
          baseUrl: values.baseUrl,
          inventoryTokenId: values.inventoryTokenId,
          inventoryTokenSecretEncrypted: values.inventoryTokenSecretEncrypted,
          ctCveTokenId: values.ctCveTokenId,
          ctCveTokenSecretEncrypted: values.ctCveTokenSecretEncrypted,
          updatedAt: now,
        },
      })
  })

  const saved = await getConnectorRowForOrg(orgId)
  if (!saved) {
    throw new Error('Failed to save CT-CVE connector settings')
  }
  return rowToFull(saved)
}

export async function deleteCtCveConnectorSettings(orgId: string): Promise<void> {
  const { withOrgDatabaseScope } = await import('../../db/index.ts')
  await withOrgDatabaseScope(orgId, async (scopedDb) => {
    await scopedDb
      .delete(ctCveConnectorSettings)
      .where(eq(ctCveConnectorSettings.organisationId, orgId))
  })
}

export function toCtCveInventoryPushTarget(
  settings: CtCveConnectorSettingsFull,
): CtCveInventoryPushTarget {
  return {
    name: settings.name,
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    token: {
      id: settings.inventoryTokenId,
      secret: settings.inventoryTokenSecret,
      orgId: settings.organisationId,
      scopes: ['inventory:write', 'connection:read'],
    },
  }
}

export function toCtCveServiceToken(settings: CtCveConnectorSettingsFull): CtCveServiceToken {
  return {
    id: settings.ctCveTokenId,
    secret: settings.ctCveTokenSecret,
    orgId: settings.organisationId,
    scopes: ['findings:write', 'connection:read'],
    revoked: false,
  }
}

export async function getCtCveServiceTokensForOrg(
  orgId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CtCveServiceToken[]> {
  const row = await getConnectorRowForOrg(orgId)
  if (row) {
    if (!row.enabled) return []
    try {
      return [toCtCveServiceToken(rowToFull(row))]
    } catch {
      return []
    }
  }

  return parseCtCveServiceTokens(env.CT_CVE_SERVICE_TOKENS)
    .filter((token) => token.orgId === orgId && !token.revoked)
}

export async function listCtCveInventoryPushTargetsFromSettings(): Promise<{
  settingsCount: number
  targets: CtCveInventoryPushTarget[]
}> {
  const rows = await listConnectorRowsAcrossOrganisations()
  return {
    settingsCount: rows.length,
    targets: rows
      .filter((row) => row.enabled)
      .map(rowToFull)
      .map(toCtCveInventoryPushTarget),
  }
}

export function buildCtCveCtOpsConnectionConfig(
  settings: CtCveConnectorSettingsFull,
  ctOpsBaseUrl: string,
): CtCveCtOpsConnectionConfig {
  return {
    name: settings.name,
    orgId: settings.organisationId,
    ctOpsBaseUrl: normaliseCtOpsBaseUrl(ctOpsBaseUrl),
    inventoryTokens: [{
      id: settings.inventoryTokenId,
      secret: settings.inventoryTokenSecret,
      scopes: ['inventory:write', 'connection:read'],
    }],
    ctOpsToken: {
      id: settings.ctCveTokenId,
      secret: settings.ctCveTokenSecret,
      scopes: ['findings:write', 'connection:read'],
    },
  }
}

export function buildCtCveCtOpsConnectionJson(
  settings: CtCveConnectorSettingsFull,
  ctOpsBaseUrl: string,
): string {
  return JSON.stringify([buildCtCveCtOpsConnectionConfig(settings, ctOpsBaseUrl)], null, 2)
}

export function getDefaultCtOpsBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.BETTER_AUTH_URL?.trim() || env.AGENT_DOWNLOAD_BASE_URL?.trim()
  if (!value) return null

  try {
    return normaliseCtOpsBaseUrl(value)
  } catch {
    return null
  }
}
