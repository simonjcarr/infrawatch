import { randomUUID } from 'node:crypto'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

type FetchLike = typeof fetch
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const PLAINTEXT_SHAPED_FIELD_NAMES = new Set([
  'plaintext',
  'private_key',
  'password',
  'secret',
  'unlock_key',
  'derived_key',
  'vault_key',
  'entry_key',
])

export interface PasswordManagerClientRouteSpec {
  method: HttpMethod
  path: string
}

export const PASSWORD_MANAGER_CLIENT_ROUTE_SPECS = {
  launch: { method: 'POST', path: '/launch/ct-ops' },
  refreshSession: { method: 'POST', path: '/sessions/refresh' },
  logout: { method: 'POST', path: '/sessions/logout' },
  getSetupStatus: { method: 'GET', path: '/setup-status' },
  getUnlockMetadata: { method: 'GET', path: '/unlock-metadata' },
  getUserKey: { method: 'GET', path: '/user-key' },
  putUserKey: { method: 'PUT', path: '/user-key' },
  listVaults: { method: 'GET', path: '/vaults' },
  createVault: { method: 'POST', path: '/vaults' },
  getVault: { method: 'GET', path: '/vaults/{vaultID}' },
  updateVault: { method: 'PATCH', path: '/vaults/{vaultID}' },
  deleteVault: { method: 'DELETE', path: '/vaults/{vaultID}' },
  listEntries: { method: 'GET', path: '/vaults/{vaultID}/entries' },
  createEntry: { method: 'POST', path: '/vaults/{vaultID}/entries' },
  getEntry: { method: 'GET', path: '/vaults/{vaultID}/entries/{entryID}' },
  updateEntry: { method: 'PATCH', path: '/vaults/{vaultID}/entries/{entryID}' },
  deleteEntry: { method: 'DELETE', path: '/vaults/{vaultID}/entries/{entryID}' },
  auditCopy: { method: 'POST', path: '/vaults/{vaultID}/entries/{entryID}/copy-audit' },
  auditReveal: { method: 'POST', path: '/vaults/{vaultID}/entries/{entryID}/reveal-audit' },
  auditExport: { method: 'POST', path: '/vaults/{vaultID}/export-audit' },
  listMembers: { method: 'GET', path: '/vaults/{vaultID}/members' },
  addMember: { method: 'POST', path: '/vaults/{vaultID}/members' },
  updateMember: { method: 'PATCH', path: '/vaults/{vaultID}/members/{userID}' },
  removeMember: { method: 'DELETE', path: '/vaults/{vaultID}/members/{userID}' },
  rotateVaultKeys: { method: 'POST', path: '/vaults/{vaultID}/key-epochs' },
} satisfies Record<string, PasswordManagerClientRouteSpec>

export class PasswordManagerApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(`Password Manager API error ${status}: ${code}`)
    this.name = 'PasswordManagerApiError'
    this.status = status
    this.code = code
  }
}

export interface PasswordManagerClientOptions {
  apiBaseUrl: string
  launchPath?: string
  launchAssertionSupplier?: () => Promise<string | { assertion: string }>
  fetch?: FetchLike
}

export interface SetupStatusResponse {
  configured: boolean
}

export interface UserKeyResponse {
  encrypted_private_key_envelope: JsonObject
  kdf_metadata: JsonObject
}

export interface UnlockMetadataResponse {
  kdf_metadata: JsonObject
}

export interface VaultRecord {
  id: string
  encrypted_metadata: JsonObject
  wrapped_vault_key_envelope: JsonObject
  role: string
  current_key_epoch: number
  created_at: string
  updated_at: string
}

export interface EntryRecord {
  id: string
  vault_id: string
  encrypted_payload: JsonObject
  key_epoch: number
  created_at: string
  updated_at: string
}

export interface MemberRecord {
  user_id: string
  role: string
  wrapped_vault_key_envelope: JsonObject
  key_epoch: number
  created_at: string
  updated_at: string
}

export interface KeyEpochRecord {
  id: string
  vault_id: string
  epoch: number
  rotation_reason: string
  created_at: string
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('apiBaseUrl must be set')
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function resolvePath(template: string, params: Record<string, string> = {}): string {
  let resolved = template
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(value))
  }
  return resolved
}

function assertNoPlaintextLikeKeys(value: JsonValue, path = '$'): void {
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      assertNoPlaintextLikeKeys(nested, `${path}[${index}]`)
    }
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, nested] of Object.entries(value)) {
    if (PLAINTEXT_SHAPED_FIELD_NAMES.has(key.toLowerCase())) {
      throw new Error(`plaintext-shaped field "${key}" is not allowed in Password Manager payload helpers`)
    }
    assertNoPlaintextLikeKeys(nested, `${path}.${key}`)
  }
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${field} must be set`)
  }
  return trimmed
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined
  }

  const text = await response.text()
  if (!text) {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) {
    return
  }

  const payload = await parseResponse(response)
  const code =
    payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : 'unknown_error'
  throw new PasswordManagerApiError(response.status, code)
}

async function extractAssertion(
  fetchImpl: FetchLike,
  launchPath: string | undefined,
  launchAssertionSupplier: PasswordManagerClientOptions['launchAssertionSupplier'],
): Promise<string> {
  if (launchAssertionSupplier) {
    const supplied = await launchAssertionSupplier()
    if (typeof supplied === 'string') {
      return requireNonEmptyString(supplied, 'assertion')
    }
    return requireNonEmptyString(supplied.assertion, 'assertion')
  }

  if (!launchPath) {
    throw new Error('Either launchPath or launchAssertionSupplier must be configured')
  }

  const response = await fetchImpl(new URL(launchPath, 'http://localhost').toString(), {
    method: 'POST',
    credentials: 'include',
  })
  await throwIfNotOk(response)
  const payload = (await parseResponse(response)) as { assertion?: string } | undefined
  return requireNonEmptyString(payload?.assertion ?? '', 'assertion')
}

async function requestJson<TResponse>(
  fetchImpl: FetchLike,
  apiBaseUrl: string,
  route: PasswordManagerClientRouteSpec,
  options: {
    pathParams?: Record<string, string>
    headers?: Record<string, string>
    body?: JsonObject
  } = {},
): Promise<TResponse> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}${resolvePath(route.path, options.pathParams)}`
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }
  const init: RequestInit & { headers: Record<string, string> } = {
    method: route.method,
    credentials: 'include',
    headers,
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  const response = await fetchImpl(url, init)
  await throwIfNotOk(response)
  return (await parseResponse(response)) as TResponse
}

export function createPasswordManagerLaunchPayload(assertion: string): JsonObject {
  return {
    assertion: requireNonEmptyString(assertion, 'assertion'),
  }
}

export function createUserKeyPayload(input: {
  encryptedPrivateKeyEnvelope: JsonObject
  kdfMetadata: JsonObject
}): JsonObject {
  const encryptedPrivateKeyEnvelope = cloneJsonObject(input.encryptedPrivateKeyEnvelope)
  const kdfMetadata = cloneJsonObject(input.kdfMetadata)
  assertNoPlaintextLikeKeys(encryptedPrivateKeyEnvelope)
  assertNoPlaintextLikeKeys(kdfMetadata)

  return {
    encrypted_private_key_envelope: encryptedPrivateKeyEnvelope,
    kdf_metadata: kdfMetadata,
  }
}

export function createVaultPayload(input: {
  encryptedMetadata: JsonObject
  wrappedVaultKeyEnvelope: JsonObject
}): JsonObject {
  const encryptedMetadata = cloneJsonObject(input.encryptedMetadata)
  const wrappedVaultKeyEnvelope = cloneJsonObject(input.wrappedVaultKeyEnvelope)
  assertNoPlaintextLikeKeys(encryptedMetadata)
  assertNoPlaintextLikeKeys(wrappedVaultKeyEnvelope)

  return {
    encrypted_metadata: encryptedMetadata,
    wrapped_vault_key_envelope: wrappedVaultKeyEnvelope,
  }
}

export function updateVaultPayload(input: {
  encryptedMetadata: JsonObject
}): JsonObject {
  const encryptedMetadata = cloneJsonObject(input.encryptedMetadata)
  assertNoPlaintextLikeKeys(encryptedMetadata)

  return {
    encrypted_metadata: encryptedMetadata,
  }
}

export function createEntryPayload(input: {
  encryptedPayload: JsonObject
  keyEpoch: number
}): JsonObject {
  const encryptedPayload = cloneJsonObject(input.encryptedPayload)
  assertNoPlaintextLikeKeys(encryptedPayload)

  return {
    encrypted_payload: encryptedPayload,
    key_epoch: input.keyEpoch,
  }
}

export function updateEntryPayload(input: {
  encryptedPayload: JsonObject
  keyEpoch: number
}): JsonObject {
  return createEntryPayload(input)
}

export function createMemberPayload(input: {
  userId: string
  role: string
  wrappedVaultKeyEnvelope: JsonObject
  keyEpoch: number
}): JsonObject {
  const wrappedVaultKeyEnvelope = cloneJsonObject(input.wrappedVaultKeyEnvelope)
  assertNoPlaintextLikeKeys(wrappedVaultKeyEnvelope)

  return {
    user_id: requireNonEmptyString(input.userId, 'userId'),
    role: requireNonEmptyString(input.role, 'role'),
    wrapped_vault_key_envelope: wrappedVaultKeyEnvelope,
    key_epoch: input.keyEpoch,
  }
}

export function updateMemberPayload(input: {
  role: string
  wrappedVaultKeyEnvelope: JsonObject
  keyEpoch: number
}): JsonObject {
  const wrappedVaultKeyEnvelope = cloneJsonObject(input.wrappedVaultKeyEnvelope)
  assertNoPlaintextLikeKeys(wrappedVaultKeyEnvelope)

  return {
    role: requireNonEmptyString(input.role, 'role'),
    wrapped_vault_key_envelope: wrappedVaultKeyEnvelope,
    key_epoch: input.keyEpoch,
  }
}

export function createRotateVaultKeysPayload(input: {
  rotationReason: string
  members: Array<{
    userId: string
    wrappedVaultKeyEnvelope: JsonObject
  }>
}): JsonObject {
  return {
    rotation_reason: requireNonEmptyString(input.rotationReason, 'rotationReason'),
    members: input.members.map((member) => {
      const wrappedVaultKeyEnvelope = cloneJsonObject(member.wrappedVaultKeyEnvelope)
      assertNoPlaintextLikeKeys(wrappedVaultKeyEnvelope)
      return {
        user_id: requireNonEmptyString(member.userId, 'userId'),
        wrapped_vault_key_envelope: wrappedVaultKeyEnvelope,
      }
    }),
  }
}

export function createPasswordManagerClient(options: PasswordManagerClientOptions) {
  const fetchImpl = options.fetch ?? fetch
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl)

  return {
    async launch(): Promise<void> {
      const assertion = await extractAssertion(fetchImpl, options.launchPath, options.launchAssertionSupplier)
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.launch, {
        body: createPasswordManagerLaunchPayload(assertion),
      })
    },

    async refreshSession(): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.refreshSession)
    },

    async logout(): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.logout)
    },

    async getSetupStatus(): Promise<SetupStatusResponse> {
      return requestJson<SetupStatusResponse>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.getSetupStatus)
    },

    async getUnlockMetadata(): Promise<UnlockMetadataResponse> {
      return requestJson<UnlockMetadataResponse>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.getUnlockMetadata)
    },

    async getUserKey(): Promise<UserKeyResponse> {
      return requestJson<UserKeyResponse>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.getUserKey)
    },

    async putUserKey(input: {
      encryptedPrivateKeyEnvelope: JsonObject
      kdfMetadata: JsonObject
    }): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.putUserKey, {
        body: createUserKeyPayload(input),
      })
    },

    async listVaults(): Promise<{ vaults: VaultRecord[] }> {
      return requestJson<{ vaults: VaultRecord[] }>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.listVaults)
    },

    async createVault(input: {
      encryptedMetadata: JsonObject
      wrappedVaultKeyEnvelope: JsonObject
      idempotencyKey?: string
    }): Promise<VaultRecord> {
      return requestJson<VaultRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.createVault, {
        headers: {
          'Idempotency-Key': input.idempotencyKey ?? randomUUID(),
        },
        body: createVaultPayload(input),
      })
    },

    async getVault(vaultId: string): Promise<VaultRecord> {
      return requestJson<VaultRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.getVault, {
        pathParams: { vaultID: requireNonEmptyString(vaultId, 'vaultId') },
      })
    },

    async updateVault(input: {
      vaultId: string
      encryptedMetadata: JsonObject
    }): Promise<VaultRecord> {
      return requestJson<VaultRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.updateVault, {
        pathParams: { vaultID: requireNonEmptyString(input.vaultId, 'vaultId') },
        body: updateVaultPayload(input),
      })
    },

    async deleteVault(vaultId: string): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.deleteVault, {
        pathParams: { vaultID: requireNonEmptyString(vaultId, 'vaultId') },
      })
    },

    async listEntries(vaultId: string): Promise<{ entries: EntryRecord[] }> {
      return requestJson<{ entries: EntryRecord[] }>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.listEntries, {
        pathParams: { vaultID: requireNonEmptyString(vaultId, 'vaultId') },
      })
    },

    async createEntry(input: {
      vaultId: string
      encryptedPayload: JsonObject
      keyEpoch: number
    }): Promise<EntryRecord> {
      return requestJson<EntryRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.createEntry, {
        pathParams: { vaultID: requireNonEmptyString(input.vaultId, 'vaultId') },
        body: createEntryPayload(input),
      })
    },

    async getEntry(input: {
      vaultId: string
      entryId: string
    }): Promise<EntryRecord> {
      return requestJson<EntryRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.getEntry, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          entryID: requireNonEmptyString(input.entryId, 'entryId'),
        },
      })
    },

    async updateEntry(input: {
      vaultId: string
      entryId: string
      encryptedPayload: JsonObject
      keyEpoch: number
    }): Promise<EntryRecord> {
      return requestJson<EntryRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.updateEntry, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          entryID: requireNonEmptyString(input.entryId, 'entryId'),
        },
        body: updateEntryPayload(input),
      })
    },

    async deleteEntry(input: {
      vaultId: string
      entryId: string
    }): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.deleteEntry, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          entryID: requireNonEmptyString(input.entryId, 'entryId'),
        },
      })
    },

    async listMembers(vaultId: string): Promise<{ members: MemberRecord[] }> {
      return requestJson<{ members: MemberRecord[] }>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.listMembers, {
        pathParams: { vaultID: requireNonEmptyString(vaultId, 'vaultId') },
      })
    },

    async addMember(input: {
      vaultId: string
      userId: string
      role: string
      wrappedVaultKeyEnvelope: JsonObject
      keyEpoch: number
    }): Promise<MemberRecord> {
      return requestJson<MemberRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.addMember, {
        pathParams: { vaultID: requireNonEmptyString(input.vaultId, 'vaultId') },
        body: createMemberPayload(input),
      })
    },

    async updateMember(input: {
      vaultId: string
      userId: string
      role: string
      wrappedVaultKeyEnvelope: JsonObject
      keyEpoch: number
    }): Promise<MemberRecord> {
      return requestJson<MemberRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.updateMember, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          userID: requireNonEmptyString(input.userId, 'userId'),
        },
        body: updateMemberPayload(input),
      })
    },

    async removeMember(input: {
      vaultId: string
      userId: string
    }): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.removeMember, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          userID: requireNonEmptyString(input.userId, 'userId'),
        },
      })
    },

    async rotateVaultKeys(input: {
      vaultId: string
      rotationReason: string
      members: Array<{
        userId: string
        wrappedVaultKeyEnvelope: JsonObject
      }>
      idempotencyKey?: string
    }): Promise<KeyEpochRecord> {
      return requestJson<KeyEpochRecord>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.rotateVaultKeys, {
        pathParams: { vaultID: requireNonEmptyString(input.vaultId, 'vaultId') },
        headers: {
          'Idempotency-Key': input.idempotencyKey ?? randomUUID(),
        },
        body: createRotateVaultKeysPayload(input),
      })
    },

    async auditReveal(input: { vaultId: string; entryId: string }): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.auditReveal, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          entryID: requireNonEmptyString(input.entryId, 'entryId'),
        },
      })
    },

    async auditCopy(input: { vaultId: string; entryId: string }): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.auditCopy, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
          entryID: requireNonEmptyString(input.entryId, 'entryId'),
        },
      })
    },

    async auditExport(input: { vaultId: string }): Promise<void> {
      await requestJson<void>(fetchImpl, apiBaseUrl, PASSWORD_MANAGER_CLIENT_ROUTE_SPECS.auditExport, {
        pathParams: {
          vaultID: requireNonEmptyString(input.vaultId, 'vaultId'),
        },
      })
    },
  }
}
