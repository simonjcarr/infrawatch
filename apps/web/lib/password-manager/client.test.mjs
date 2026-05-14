import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PASSWORD_MANAGER_CLIENT_ROUTE_SPECS,
  PasswordManagerApiError,
  createPasswordManagerClient,
  createEntryPayload,
  createMemberPayload,
  createPasswordManagerLaunchPayload,
  createRotateVaultKeysPayload,
  createUserKeyPayload,
  createVaultPayload,
  lookupMemberRecipientsPayload,
  updateEntryPayload,
  updateMemberPayload,
  updateVaultPayload,
} from './client.ts'

function loadPinnedContract() {
  if (process.env.PASSWORD_MANAGER_OPENAPI_CONTRACT_PATH) {
    return JSON.parse(readFileSync(process.env.PASSWORD_MANAGER_OPENAPI_CONTRACT_PATH, 'utf8'))
  }

  const localContractPath = fileURLToPath(new URL('./api-contract/openapi.json', import.meta.url))
  try {
    return JSON.parse(readFileSync(localContractPath, 'utf8'))
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }

  const currentFilePath = fileURLToPath(import.meta.url)
  let currentDir = path.dirname(currentFilePath)

  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, 'ct-password-manager', 'docs', 'api-contract', 'openapi.json')
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        currentDir = path.dirname(currentDir)
        continue
      }
      throw error
    }
  }

  const filePath = fileURLToPath(new URL('../../../../../ct-password-manager/docs/api-contract/openapi.json', import.meta.url))
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function createJsonResponse(status, payload) {
  return new Response(payload === undefined ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('PASSWORD_MANAGER_CLIENT_ROUTE_SPECS matches the pinned Password Manager contract', () => {
  const contract = loadPinnedContract()
  const actual = new Set(
    Object.values(PASSWORD_MANAGER_CLIENT_ROUTE_SPECS).map(
      ({ method, path }) => `${method.toUpperCase()} ${path}`,
    ),
  )
  const expected = new Set(
    Object.entries(contract.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    ),
  )
  expected.delete('GET /healthz')

  assert.deepEqual([...actual].sort(), [...expected].sort())
})

test('launch fetches a fresh assertion and exchanges it with Password Manager using credentials', async () => {
  const calls = []
  const client = createPasswordManagerClient({
    apiBaseUrl: 'https://ops.example.test/password-manager-api/',
    launchPath: '/api/password-manager/launch-assertion',
    fetch: async (input, init = {}) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        init,
      })

      if (calls.length === 1) {
        return createJsonResponse(200, { assertion: 'signed-launch-assertion' })
      }

      return new Response(null, { status: 204 })
    },
  })

  await client.launch()

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/api/password-manager/launch-assertion')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'include')

  assert.equal(calls[1].url, 'https://ops.example.test/password-manager-api/launch/ct-ops')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.credentials, 'include')
  assert.match(String(calls[1].init.body), /signed-launch-assertion/)
})

test('createVault and rotateVaultKeys preserve the supplied Idempotency-Key header', async () => {
  const calls = []
  const client = createPasswordManagerClient({
    apiBaseUrl: 'https://ops.example.test/password-manager-api',
    fetch: async (input, init = {}) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        init,
      })
      return createJsonResponse(201, {
        id: 'vault-1',
        encrypted_metadata: { ciphertext_b64: 'meta' },
        wrapped_vault_key_envelope: { wrapped_key_b64: 'wrapped' },
        role: 'owner',
        current_key_epoch: 1,
        created_at: '2026-05-05T18:00:00Z',
        updated_at: '2026-05-05T18:00:00Z',
      })
    },
  })

  await client.createVault({
    idempotencyKey: 'vault-create-key',
    encryptedMetadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
  })

  await client.rotateVaultKeys({
    vaultId: 'vault-1',
    idempotencyKey: 'rotate-key',
    rotationReason: 'membership_revoked',
    members: [{ userId: 'user-1', wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'ZA==' } }],
  })

  assert.equal(calls[0].init.headers['Idempotency-Key'], 'vault-create-key')
  assert.equal(calls[1].init.headers['Idempotency-Key'], 'rotate-key')
})

test('lookupMemberRecipients posts CT-Ops user IDs for a vault-scoped public key lookup', async () => {
  const calls = []
  const client = createPasswordManagerClient({
    apiBaseUrl: 'https://ops.example.test/password-manager-api',
    fetch: async (input, init = {}) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        init,
      })
      return createJsonResponse(200, {
        recipients: [
          {
            external_user_id: 'ct-user-2',
            user_id: 'pm-user-2',
            email: 'two@example.test',
            display_name: 'User Two',
            setup_configured: true,
            public_key_envelope: {
              version: 1,
              algorithm: 'rsa-oaep-256',
              public_key_spki_b64: 'cHVibGljLWtleQ==',
            },
          },
        ],
      })
    },
  })

  const response = await client.lookupMemberRecipients({
    vaultId: 'vault-1',
    externalUserIds: ['ct-user-2'],
  })

  assert.equal(calls[0].url, 'https://ops.example.test/password-manager-api/vaults/vault-1/member-recipients')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { external_user_ids: ['ct-user-2'] })
  assert.equal(response.recipients[0].public_key_envelope.public_key_spki_b64, 'cHVibGljLWtleQ==')
})

test('createVault generates an Idempotency-Key through the runtime crypto API when one is not supplied', async () => {
  const calls = []
  const originalCrypto = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => 'generated-idempotency-key',
    },
  })

  try {
    const client = createPasswordManagerClient({
      apiBaseUrl: 'https://ops.example.test/password-manager-api',
      fetch: async (input, init = {}) => {
        calls.push({
          url: input instanceof Request ? input.url : String(input),
          init,
        })
        return createJsonResponse(201, {
          id: 'vault-1',
          encrypted_metadata: { ciphertext_b64: 'meta' },
          wrapped_vault_key_envelope: { wrapped_key_b64: 'wrapped' },
          role: 'owner',
          current_key_epoch: 1,
          created_at: '2026-05-05T18:00:00Z',
          updated_at: '2026-05-05T18:00:00Z',
        })
      },
    })

    await client.createVault({
      encryptedMetadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
      wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
    })
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
  }

  assert.equal(calls[0].init.headers['Idempotency-Key'], 'generated-idempotency-key')
})

test('audit routes send empty bodies only', async () => {
  const calls = []
  const client = createPasswordManagerClient({
    apiBaseUrl: 'https://ops.example.test/password-manager-api',
    fetch: async (input, init = {}) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        init,
      })
      return new Response(null, { status: 204 })
    },
  })

  await client.auditReveal({ vaultId: 'vault-1', entryId: 'entry-1' })
  await client.auditCopy({ vaultId: 'vault-1', entryId: 'entry-1' })
  await client.auditExport({ vaultId: 'vault-1' })

  for (const call of calls) {
    assert.equal(call.init.method, 'POST')
    assert.equal(call.init.credentials, 'include')
    assert.equal('body' in call.init, false)
  }
})

test('audit list routes use redacted read contract with filters', async () => {
  const calls = []
  const client = createPasswordManagerClient({
    apiBaseUrl: 'https://ops.example.test/password-manager-api',
    fetch: async (input, init = {}) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        init,
      })
      if (String(input).endsWith('/audit-events/integrity')) {
        return createJsonResponse(200, {
          latest_sequence_number: 3,
          latest_event_hash: 'abc123',
          verified: true,
          checked_events: 3,
        })
      }
      return createJsonResponse(200, {
        events: [
          {
            id: 'event-1',
            created_at: '2026-05-05T07:30:00Z',
            actor_user_id: 'user-1',
            actor_email: 'user@example.test',
            actor_display_name: 'User One',
            event_type: 'entry.copied',
            object_type: 'entry',
            object_id: 'entry-1',
            vault_id: 'vault-1',
            outcome: 'success',
            summary: 'User One copied a secret field.',
            metadata: { field_type: 'password' },
          },
        ],
        next_cursor: '3',
      })
    },
  })

  const events = await client.listAuditEvents({
    vaultId: 'vault-1',
    eventType: 'entry.copied',
    outcome: 'success',
    limit: 25,
  })
  const integrity = await client.getAuditIntegrityStatus()

  assert.equal(events.events[0].summary, 'User One copied a secret field.')
  assert.equal(events.next_cursor, '3')
  assert.equal(integrity.verified, true)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.credentials, 'include')
  assert.match(calls[0].url, /\/audit-events\?/)
  assert.match(calls[0].url, /vault_id=vault-1/)
  assert.match(calls[0].url, /event_type=entry\.copied/)
  assert.equal(calls[1].url, 'https://ops.example.test/password-manager-api/audit-events/integrity')
})

test('request payload helpers reject plaintext-shaped fields', () => {
  assert.throws(
    () =>
      createUserKeyPayload({
        encryptedPrivateKeyEnvelope: { ciphertext_b64: 'abc', private_key: 'plaintext' },
        kdfMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
      }),
    /plaintext-shaped field/i,
  )

  assert.throws(
    () =>
      createVaultPayload({
        encryptedMetadata: { ciphertext_b64: 'abc', plaintext: 'secret' },
        wrappedVaultKeyEnvelope: { wrapped_key_b64: 'wrapped' },
      }),
    /plaintext-shaped field/i,
  )

  assert.throws(
    () =>
      createEntryPayload({
        encryptedPayload: { ciphertext_b64: 'abc', secret: 'plaintext' },
        keyEpoch: 1,
      }),
    /plaintext-shaped field/i,
  )

  assert.throws(
    () =>
      createMemberPayload({
        userId: 'user-1',
        role: 'viewer',
        wrappedVaultKeyEnvelope: { wrapped_key_b64: 'abc', vault_key: 'plaintext' },
        keyEpoch: 1,
      }),
    /plaintext-shaped field/i,
  )
})

test('createUserKeyPayload accepts the CT-Ops browser-envelope setup payload', () => {
  const payload = createUserKeyPayload({
    encryptedPrivateKeyEnvelope: {
      version: 1,
      algorithm: 'rsa-oaep-256',
      public_key_spki_b64: 'cHVibGljLWtleQ==',
      iv_b64: 'MDEyMzQ1Njc4OWFi',
      ciphertext_b64: 'Y2lwaGVydGV4dA==',
    },
    kdfMetadata: {
      algorithm: 'pbkdf2-sha256',
      salt_b64: 'MDEyMzQ1Njc4OWFiY2RlZg==',
      iterations: 600000,
      derived_key_length: 32,
    },
  })

  assert.deepEqual(payload, {
    encrypted_private_key_envelope: {
      version: 1,
      algorithm: 'rsa-oaep-256',
      public_key_spki_b64: 'cHVibGljLWtleQ==',
      iv_b64: 'MDEyMzQ1Njc4OWFi',
      ciphertext_b64: 'Y2lwaGVydGV4dA==',
    },
    kdf_metadata: {
      algorithm: 'pbkdf2-sha256',
      salt_b64: 'MDEyMzQ1Njc4OWFiY2RlZg==',
      iterations: 600000,
      derived_key_length: 32,
    },
  })
})

test('request payload helpers serialize supported encrypted shapes', () => {
  assert.deepEqual(createPasswordManagerLaunchPayload('assertion-token'), { assertion: 'assertion-token' })
  assert.deepEqual(createVaultPayload({
    encryptedMetadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
  }), {
    encrypted_metadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    wrapped_vault_key_envelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
  })
  assert.deepEqual(updateVaultPayload({
    encryptedMetadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
  }), {
    encrypted_metadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
  })
  assert.deepEqual(createEntryPayload({
    encryptedPayload: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    keyEpoch: 3,
  }), {
    encrypted_payload: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    key_epoch: 3,
  })
  assert.deepEqual(updateEntryPayload({
    encryptedPayload: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    keyEpoch: 4,
  }), {
    encrypted_payload: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
    key_epoch: 4,
  })
  assert.deepEqual(lookupMemberRecipientsPayload({
    externalUserIds: ['user-1', 'user-2'],
  }), {
    external_user_ids: ['user-1', 'user-2'],
  })
  assert.deepEqual(createMemberPayload({
    userId: 'user-1',
    role: 'viewer',
    wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
    keyEpoch: 1,
  }), {
    user_id: 'user-1',
    role: 'viewer',
    wrapped_vault_key_envelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
    key_epoch: 1,
  })
  assert.deepEqual(updateMemberPayload({
    role: 'manager',
    wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
    keyEpoch: 2,
  }), {
    role: 'manager',
    wrapped_vault_key_envelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
    key_epoch: 2,
  })
  assert.deepEqual(createRotateVaultKeysPayload({
    rotationReason: 'membership_revoked',
    members: [
      { userId: 'user-1', wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' } },
    ],
  }), {
    rotation_reason: 'membership_revoked',
    members: [
      { user_id: 'user-1', wrapped_vault_key_envelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' } },
    ],
  })
})

test('non-success responses surface a normalized PasswordManagerApiError', async () => {
  const client = createPasswordManagerClient({
    apiBaseUrl: 'https://ops.example.test/password-manager-api',
    fetch: async () => createJsonResponse(409, { error: 'idempotency_conflict' }),
  })

  await assert.rejects(
    () =>
      client.createVault({
        idempotencyKey: 'vault-create-key',
        encryptedMetadata: { version: 1, algorithm: 'aes-256-gcm', iv_b64: 'aQ==', ciphertext_b64: 'Yg==' },
        wrappedVaultKeyEnvelope: { version: 1, algorithm: 'rsa-oaep-256', wrapped_key_b64: 'Yw==' },
      }),
    (error) =>
      error instanceof PasswordManagerApiError &&
      error.status === 409 &&
      error.code === 'idempotency_conflict',
  )
})
