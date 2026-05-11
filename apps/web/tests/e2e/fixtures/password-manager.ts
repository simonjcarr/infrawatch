import { randomUUID, generateKeyPairSync } from 'node:crypto'
import type { BrowserContext, Route } from '@playwright/test'
import { getTestDb } from './db'
import { TEST_PASSWORD_MANAGER_MEMBER, TEST_USER } from './seed'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface PasswordManagerMockRequest {
  method: string
  path: string
  headers: Record<string, string>
  rawBody: string
  jsonBody: JsonValue | null
  credentialsCookie: boolean
}

interface PasswordManagerMemberEnvelope {
  version: number
  algorithm: string
  public_key_spki_b64: string
}

interface PasswordManagerMockState {
  sessionToken: string | null
  launchAssertions: string[]
  userKey:
    | {
        encrypted_private_key_envelope: JsonValue
        kdf_metadata: JsonValue
      }
    | null
  currentUserId: string
  currentInstanceId: string
  failNextRefresh: boolean
  requests: PasswordManagerMockRequest[]
  vaults: Map<
    string,
    {
      record: Record<string, JsonValue>
      entries: Map<string, Record<string, JsonValue>>
      members: Map<string, Record<string, JsonValue>>
      nextEntryNumber: number
      nextEpochNumber: number
    }
  >
}

export interface PasswordManagerMockController {
  getMemberEnvelope(userId: string): PasswordManagerMemberEnvelope
  failNextRefreshWithSessionExpiry(): void
  switchAuthenticatedInstance(): Promise<void>
  launchAssertions(): string[]
  requestsFor(method: string, path: string): PasswordManagerMockRequest[]
  auditRequests(): PasswordManagerMockRequest[]
  apiRequests(): PasswordManagerMockRequest[]
  detectPlaintextLeak(): string | null
}

const PM_API_PREFIX = '/password-manager-api'
const PM_SESSION_COOKIE = 'pm_session'
const PLAINTEXT_FIELD_NAMES = new Set([
  'plaintext',
  'private_key',
  'password',
  'secret',
  'unlock_key',
  'derived_key',
  'vault_key',
  'entry_key',
])

function nowIso(): string {
  return new Date().toISOString()
}

function decodeJwtPayload(assertion: string): Record<string, string> {
  const [, payload] = assertion.split('.')
  if (!payload) throw new Error('launch assertion payload missing')
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, string>
}

function parseJsonBody(rawBody: string): JsonValue | null {
  if (!rawBody) return null
  try {
    return JSON.parse(rawBody) as JsonValue
  } catch {
    return null
  }
}

function jsonValueOrFallback(value: JsonValue | undefined, fallback: JsonValue): JsonValue {
  return value === undefined ? fallback : value
}

function numberValueOrFallback(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function readRecordJsonValue(record: Record<string, JsonValue>, key: string, fallback: JsonValue): JsonValue {
  const value = record[key]
  return value === undefined ? fallback : value
}

function readRecordStringValue(record: Record<string, JsonValue>, key: string, fallback: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : fallback
}

function readObjectNumberValue(record: { [key: string]: JsonValue }, key: string, fallback: number): number {
  const value = record[key]
  return typeof value === 'number' ? value : fallback
}

function publicEnvelopeJson(envelope: PasswordManagerMemberEnvelope): { [key: string]: JsonValue } {
  return {
    version: envelope.version,
    algorithm: envelope.algorithm,
    public_key_spki_b64: envelope.public_key_spki_b64,
  }
}

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function findPlaintextField(value: JsonValue): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const leak = findPlaintextField(item)
      if (leak) return leak
    }
    return null
  }

  if (!isPlainObject(value)) {
    return null
  }

  for (const [key, nested] of Object.entries(value)) {
    if (PLAINTEXT_FIELD_NAMES.has(key.toLowerCase())) {
      return key
    }
    const leak = findPlaintextField(nested)
    if (leak) return leak
  }

  return null
}

function createMemberEnvelope(): PasswordManagerMemberEnvelope {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { format: 'der', type: 'spki' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  })

  return {
    version: 1,
    algorithm: 'rsa-oaep-256',
    public_key_spki_b64: publicKey.toString('base64'),
  }
}

async function getCurrentUserState() {
  const sql = getTestDb()
  const rows = await sql<Array<{ user_id: string; instance_id: string }>>`
    SELECT id AS user_id, instance_id
    FROM "user"
    WHERE email = ${TEST_USER.email}
    LIMIT 1
  `
  if (rows.length !== 1 || !rows[0]?.instance_id) {
    throw new Error('expected seeded test user with instance')
  }
  return rows[0]
}

async function getPasswordManagerMemberState() {
  const sql = getTestDb()
  const rows = await sql<Array<{ user_id: string; instance_id: string }>>`
    SELECT id AS user_id, instance_id
    FROM "user"
    WHERE email = ${TEST_PASSWORD_MANAGER_MEMBER.email}
    LIMIT 1
  `
  if (rows.length !== 1 || !rows[0]?.instance_id) {
    throw new Error('expected seeded Password Manager member with instance')
  }
  return rows[0]
}

async function fulfillJson(route: Route, status: number, body: JsonValue, headers: Record<string, string> = {}) {
  await route.fulfill({
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function fulfillEmpty(route: Route, status: number, headers: Record<string, string> = {}) {
  await route.fulfill({
    status,
    headers,
    body: '',
  })
}

export async function createPasswordManagerMock(context: BrowserContext): Promise<PasswordManagerMockController> {
  const currentUser = await getCurrentUserState()
  const passwordManagerMember = await getPasswordManagerMemberState()
  const memberEnvelopes = new Map<string, PasswordManagerMemberEnvelope>([[passwordManagerMember.user_id, createMemberEnvelope()]])

  const state: PasswordManagerMockState = {
    sessionToken: null,
    launchAssertions: [],
    userKey: null,
    currentUserId: currentUser.user_id,
    currentInstanceId: currentUser.instance_id,
    failNextRefresh: false,
    requests: [],
    vaults: new Map(),
  }

  await context.route('**/password-manager-api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.startsWith(PM_API_PREFIX) ? url.pathname.slice(PM_API_PREFIX.length) || '/' : url.pathname
    const method = request.method().toUpperCase()
    const headers = Object.fromEntries(Object.entries(request.headers()).map(([key, value]) => [key.toLowerCase(), value]))
    const rawBody = request.postData() ?? ''
    const jsonBody = parseJsonBody(rawBody)

    state.requests.push({
      method,
      path,
      headers,
      rawBody,
      jsonBody,
      credentialsCookie: headers.cookie?.includes(`${PM_SESSION_COOKIE}=`) ?? false,
    })

    const sessionCookie = headers.cookie?.includes(`${PM_SESSION_COOKIE}=${state.sessionToken}`) ?? false
    const ensureSession = async () => {
      if (!state.sessionToken || !sessionCookie) {
        await fulfillJson(route, 401, { error: 'session_expired' })
        return false
      }
      return true
    }

    if (method === 'POST' && path === '/launch/ct-ops') {
      const assertion = isPlainObject(jsonBody) && typeof jsonBody.assertion === 'string' ? jsonBody.assertion : ''
      if (!assertion) {
        await fulfillJson(route, 400, { error: 'missing_assertion' })
        return
      }

      const payload = decodeJwtPayload(assertion)
      state.launchAssertions.push(assertion)
      state.currentUserId = payload.ct_ops_user_id || state.currentUserId
      state.currentInstanceId = payload.ct_ops_organization_id || state.currentInstanceId
      state.sessionToken = randomUUID()

      await fulfillEmpty(route, 204, {
        'Set-Cookie': `${PM_SESSION_COOKIE}=${state.sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
      })
      return
    }

    if (method === 'GET' && path === '/setup-status') {
      if (!await ensureSession()) return
      await fulfillJson(route, 200, { configured: state.userKey !== null })
      return
    }

    if (method === 'PUT' && path === '/user-key') {
      if (!await ensureSession()) return
      state.userKey = {
        encrypted_private_key_envelope: isPlainObject(jsonBody) ? (jsonBody.encrypted_private_key_envelope ?? null) : null,
        kdf_metadata: isPlainObject(jsonBody) ? (jsonBody.kdf_metadata ?? null) : null,
      }
      await fulfillEmpty(route, 204)
      return
    }

    if (method === 'GET' && path === '/unlock-metadata') {
      if (!await ensureSession()) return
      if (!state.userKey) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }
      await fulfillJson(route, 200, { kdf_metadata: state.userKey.kdf_metadata })
      return
    }

    if (method === 'GET' && path === '/user-key') {
      if (!await ensureSession()) return
      if (!state.userKey) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }
      await fulfillJson(route, 200, state.userKey as unknown as JsonValue)
      return
    }

    if (method === 'POST' && path === '/sessions/refresh') {
      if (!await ensureSession()) return
      if (state.failNextRefresh) {
        state.failNextRefresh = false
        state.sessionToken = null
        await fulfillJson(route, 401, { error: 'session_expired' })
        return
      }
      await fulfillEmpty(route, 204)
      return
    }

    if (method === 'POST' && path === '/sessions/logout') {
      state.sessionToken = null
      await fulfillEmpty(route, 204, {
        'Set-Cookie': `${PM_SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`,
      })
      return
    }

    if (!await ensureSession()) return

    if (method === 'GET' && path === '/audit-events') {
      await fulfillJson(route, 200, {
        events: [
          {
            id: 'audit-event-1',
            created_at: nowIso(),
            actor_user_id: state.currentUserId,
            actor_email: TEST_USER.email,
            actor_display_name: TEST_USER.name,
            event_type: 'entry.copied',
            object_type: 'entry',
            object_id: 'entry-2',
            vault_id: 'vault-1',
            outcome: 'success',
            summary: `${TEST_USER.name} copied a secret field.`,
            metadata: { field_type: 'password' },
          },
          {
            id: 'audit-event-2',
            created_at: nowIso(),
            actor_user_id: state.currentUserId,
            actor_email: TEST_USER.email,
            actor_display_name: TEST_USER.name,
            event_type: 'vault.member_added',
            object_type: 'vault_member',
            object_id: state.currentUserId,
            vault_id: 'vault-1',
            outcome: 'success',
            summary: `${TEST_USER.name} added a vault member.`,
            metadata: { role: 'viewer' },
          },
        ],
        next_cursor: '',
      })
      return
    }

    if (method === 'GET' && path === '/audit-events/integrity') {
      await fulfillJson(route, 200, {
        latest_sequence_number: 2,
        latest_event_hash: 'abcdef1234567890',
        verified: true,
        checked_events: 2,
      })
      return
    }

    if (method === 'GET' && path === '/vaults') {
      await fulfillJson(route, 200, {
        vaults: Array.from(state.vaults.values()).map((vault) => vault.record),
      })
      return
    }

    const memberRecipientsMatch = path.match(/^\/vaults\/([^/]+)\/member-recipients$/)
    if (memberRecipientsMatch && method === 'POST' && isPlainObject(jsonBody) && Array.isArray(jsonBody.external_user_ids)) {
      const vault = state.vaults.get(memberRecipientsMatch[1]!)
      if (!vault) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }

      const recipients: JsonValue[] = jsonBody.external_user_ids
        .filter((value): value is string => typeof value === 'string')
        .map((externalUserId) => {
          const currentEncryptedEnvelope = state.userKey?.encrypted_private_key_envelope
          if (externalUserId === state.currentUserId && currentEncryptedEnvelope !== undefined && isPlainObject(currentEncryptedEnvelope)) {
            const encryptedEnvelope = currentEncryptedEnvelope
            return {
              external_user_id: externalUserId,
              user_id: externalUserId,
              email: TEST_USER.email,
              display_name: TEST_USER.name,
              setup_configured: true,
              public_key_envelope: {
                version: readObjectNumberValue(encryptedEnvelope, 'version', 1),
                algorithm: readRecordStringValue(encryptedEnvelope, 'algorithm', 'rsa-oaep-256'),
                public_key_spki_b64: readRecordStringValue(encryptedEnvelope, 'public_key_spki_b64', ''),
              },
            }
          }

          const memberEnvelope = memberEnvelopes.get(externalUserId)
          return {
            external_user_id: externalUserId,
            user_id: externalUserId,
            email: externalUserId === passwordManagerMember.user_id ? TEST_PASSWORD_MANAGER_MEMBER.email : `${externalUserId}@example.test`,
            display_name: externalUserId === passwordManagerMember.user_id ? TEST_PASSWORD_MANAGER_MEMBER.name : externalUserId,
            setup_configured: Boolean(memberEnvelope),
            public_key_envelope: memberEnvelope ? publicEnvelopeJson(memberEnvelope) : null,
          }
        })

      await fulfillJson(route, 200, { recipients })
      return
    }

    if (method === 'POST' && path === '/vaults' && isPlainObject(jsonBody)) {
      const id = `vault-${state.vaults.size + 1}`
      const createdAt = nowIso()
      const record = {
        id,
        encrypted_metadata: jsonBody.encrypted_metadata ?? {},
        wrapped_vault_key_envelope: jsonBody.wrapped_vault_key_envelope ?? {},
        role: 'owner',
        current_key_epoch: 1,
        created_at: createdAt,
        updated_at: createdAt,
      }
      state.vaults.set(id, {
        record,
        entries: new Map(),
        members: new Map([
          [
            state.currentUserId,
            {
              user_id: state.currentUserId,
              role: 'owner',
              wrapped_vault_key_envelope: jsonBody.wrapped_vault_key_envelope ?? {},
              key_epoch: 1,
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
        ]),
        nextEntryNumber: 1,
        nextEpochNumber: 2,
      })
      await fulfillJson(route, 200, record)
      return
    }

    const vaultMatch = path.match(/^\/vaults\/([^/]+)$/)
    if (vaultMatch) {
      const vault = state.vaults.get(vaultMatch[1]!)
      if (!vault) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }

      if (method === 'GET') {
        await fulfillJson(route, 200, vault.record)
        return
      }
      if (method === 'PATCH' && isPlainObject(jsonBody)) {
        vault.record.encrypted_metadata = jsonValueOrFallback(
          jsonBody.encrypted_metadata,
          readRecordJsonValue(vault.record, 'encrypted_metadata', {}),
        )
        vault.record.updated_at = nowIso()
        await fulfillJson(route, 200, vault.record)
        return
      }
      if (method === 'DELETE') {
        state.vaults.delete(vaultMatch[1]!)
        await fulfillEmpty(route, 204)
        return
      }
    }

    const entriesMatch = path.match(/^\/vaults\/([^/]+)\/entries$/)
    if (entriesMatch) {
      const vault = state.vaults.get(entriesMatch[1]!)
      if (!vault) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }

      if (method === 'GET') {
        await fulfillJson(route, 200, { entries: Array.from(vault.entries.values()) })
        return
      }
      if (method === 'POST' && isPlainObject(jsonBody)) {
        const id = `entry-${vault.nextEntryNumber++}`
        const createdAt = nowIso()
        const record = {
          id,
          vault_id: entriesMatch[1]!,
          encrypted_payload: jsonValueOrFallback(jsonBody.encrypted_payload, {}),
          key_epoch: numberValueOrFallback(jsonBody.key_epoch, Number(vault.record.current_key_epoch)),
          created_at: createdAt,
          updated_at: createdAt,
        }
        vault.entries.set(id, record)
        await fulfillJson(route, 200, record)
        return
      }
    }

    const entryMatch = path.match(/^\/vaults\/([^/]+)\/entries\/([^/]+)$/)
    if (entryMatch) {
      const vault = state.vaults.get(entryMatch[1]!)
      const entry = vault?.entries.get(entryMatch[2]!)
      if (!vault || !entry) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }

      if (method === 'GET') {
        await fulfillJson(route, 200, entry)
        return
      }
      if (method === 'PATCH' && isPlainObject(jsonBody)) {
        entry.encrypted_payload = jsonValueOrFallback(
          jsonBody.encrypted_payload,
          readRecordJsonValue(entry, 'encrypted_payload', {}),
        )
        entry.key_epoch = numberValueOrFallback(jsonBody.key_epoch, Number(entry.key_epoch))
        entry.updated_at = nowIso()
        await fulfillJson(route, 200, entry)
        return
      }
      if (method === 'DELETE') {
        vault.entries.delete(entryMatch[2]!)
        await fulfillEmpty(route, 204)
        return
      }
    }

    const membersMatch = path.match(/^\/vaults\/([^/]+)\/members$/)
    if (membersMatch) {
      const vault = state.vaults.get(membersMatch[1]!)
      if (!vault) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }

      if (method === 'GET') {
        await fulfillJson(route, 200, { members: Array.from(vault.members.values()) })
        return
      }
      if (method === 'POST' && isPlainObject(jsonBody) && typeof jsonBody.user_id === 'string') {
        const timestamp = nowIso()
        const record = {
          user_id: jsonBody.user_id,
          role: typeof jsonBody.role === 'string' ? jsonBody.role : 'viewer',
          wrapped_vault_key_envelope: jsonValueOrFallback(jsonBody.wrapped_vault_key_envelope, {}),
          key_epoch: numberValueOrFallback(jsonBody.key_epoch, Number(vault.record.current_key_epoch)),
          created_at: timestamp,
          updated_at: timestamp,
        }
        vault.members.set(record.user_id, record)
        await fulfillJson(route, 200, record)
        return
      }
    }

    const memberMatch = path.match(/^\/vaults\/([^/]+)\/members\/([^/]+)$/)
    if (memberMatch) {
      const vault = state.vaults.get(memberMatch[1]!)
      const member = vault?.members.get(decodeURIComponent(memberMatch[2]!))
      if (!vault || !member) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }

      if (method === 'PATCH' && isPlainObject(jsonBody)) {
        member.role = typeof jsonBody.role === 'string' ? jsonBody.role : readRecordStringValue(member, 'role', 'viewer')
        member.wrapped_vault_key_envelope = jsonValueOrFallback(
          jsonBody.wrapped_vault_key_envelope,
          readRecordJsonValue(member, 'wrapped_vault_key_envelope', {}),
        )
        member.key_epoch = numberValueOrFallback(jsonBody.key_epoch, Number(member.key_epoch))
        member.updated_at = nowIso()
        await fulfillJson(route, 200, member)
        return
      }
      if (method === 'DELETE') {
        vault.members.delete(decodeURIComponent(memberMatch[2]!))
        await fulfillEmpty(route, 204)
        return
      }
    }

    const rotateMatch = path.match(/^\/vaults\/([^/]+)\/key-epochs$/)
    if (rotateMatch) {
      const vault = state.vaults.get(rotateMatch[1]!)
      if (!vault || !isPlainObject(jsonBody) || !Array.isArray(jsonBody.members)) {
        await fulfillJson(route, 404, { error: 'not_found' })
        return
      }
      const epoch = vault.nextEpochNumber++
      vault.record.current_key_epoch = epoch
      vault.record.updated_at = nowIso()
      for (const member of jsonBody.members) {
        if (!isPlainObject(member) || typeof member.user_id !== 'string') continue
        const current = vault.members.get(member.user_id)
        if (!current) continue
        current.wrapped_vault_key_envelope = jsonValueOrFallback(
          member.wrapped_vault_key_envelope,
          readRecordJsonValue(current, 'wrapped_vault_key_envelope', {}),
        )
        current.key_epoch = epoch
        current.updated_at = nowIso()
      }
      await fulfillJson(route, 200, {
        id: `epoch-${epoch}`,
        vault_id: rotateMatch[1]!,
        epoch,
        rotation_reason: typeof jsonBody.rotation_reason === 'string' ? jsonBody.rotation_reason : 'membership_changed',
        created_at: nowIso(),
      })
      return
    }

    if (
      method === 'POST' &&
      (/^\/vaults\/[^/]+\/entries\/[^/]+\/(?:copy-audit|reveal-audit)$/.test(path) || /^\/vaults\/[^/]+\/export-audit$/.test(path))
    ) {
      await fulfillEmpty(route, 204)
      return
    }

    await fulfillJson(route, 500, { error: 'unhandled_mock_route', path, method })
  })

  return {
    getMemberEnvelope(userId: string) {
      const envelope = memberEnvelopes.get(userId)
      if (!envelope) {
        const generated = createMemberEnvelope()
        memberEnvelopes.set(userId, generated)
        return generated
      }
      return envelope
    },
    failNextRefreshWithSessionExpiry() {
      state.failNextRefresh = true
    },
    async switchAuthenticatedInstance() {
      const sql = getTestDb()
      const instanceId = `org-switched-${Date.now()}`
      await sql`
        INSERT INTO instance_settings (id, name, slug)
        VALUES (${instanceId}, ${'Switched Org'}, ${`switched-org-${Date.now()}`})
      `
      await sql`
        UPDATE "user"
        SET instance_id = ${instanceId}, updated_at = NOW()
        WHERE email = ${TEST_USER.email}
      `
      state.currentInstanceId = instanceId
      state.sessionToken = null
      state.userKey = null
      state.vaults.clear()
    },
    launchAssertions() {
      return [...state.launchAssertions]
    },
    requestsFor(method: string, path: string) {
      return state.requests.filter((request) => request.method === method && request.path === path)
    },
    auditRequests() {
      return state.requests.filter((request) => request.path.endsWith('/copy-audit') || request.path.endsWith('/reveal-audit') || request.path.endsWith('/export-audit'))
    },
    apiRequests() {
      return state.requests.filter((request) => request.path !== '/launch/ct-ops' && request.path !== '/sessions/logout')
    },
    detectPlaintextLeak() {
      for (const request of state.requests) {
        if (!request.jsonBody) continue
        const leak = findPlaintextField(request.jsonBody)
        if (leak) {
          return `${request.method} ${request.path} contains disallowed field ${leak}`
        }
      }
      return null
    },
  }
}
