import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION,
  createPasswordVaultSetupStatus,
  createPasswordVaultUserKeyConflictResponse,
  parsePasswordVaultUserKeyPayload,
  serializePasswordVaultUserKey,
} from './profile-api.ts'

const validPayload = {
  publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvaultPublicKey000000000000000000000000',
  encryptedPrivateKeyEnvelope: {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: 'vaultPrivateIv01',
    ciphertext: 'vaultPrivateCiphertext000000000000000000000000',
  },
  kdfParams: {
    version: 1,
    algorithm: 'argon2id',
    memoryKiB: 64 * 1024,
    iterations: 3,
    parallelism: 1,
    keyLength: 32,
    salt: 'vaultKdfSalt000000',
  },
  envelopeVersion: PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION,
}

function userKeyRecord(overrides = {}) {
  return {
    ...validPayload,
    setupCompletedAt: new Date('2026-05-04T15:00:00.000Z'),
    updatedAt: new Date('2026-05-04T15:05:00.000Z'),
    ...overrides,
  }
}

test('password vault setup status does not expose user key material', () => {
  assert.deepEqual(createPasswordVaultSetupStatus(null), {
    configured: false,
    setupCompletedAt: null,
  })

  assert.deepEqual(createPasswordVaultSetupStatus(userKeyRecord()), {
    configured: true,
    setupCompletedAt: '2026-05-04T15:00:00.000Z',
  })
})

test('password vault user-key payload accepts only opaque browser encrypted material', () => {
  assert.deepEqual(parsePasswordVaultUserKeyPayload(validPayload), validPayload)

  assert.throws(
    () => parsePasswordVaultUserKeyPayload({
      ...validPayload,
      unlockPassword: 'plaintext must stay in the browser',
    }),
    /unrecognized key/i,
  )

  assert.throws(
    () => parsePasswordVaultUserKeyPayload({
      ...validPayload,
      encryptedPrivateKeyEnvelope: {
        ...validPayload.encryptedPrivateKeyEnvelope,
        plaintextPrivateKey: 'not allowed',
      },
    }),
    /unrecognized key/i,
  )
})

test('password vault user-key payload enforces Argon2id MVP floors', () => {
  assert.throws(
    () => parsePasswordVaultUserKeyPayload({
      ...validPayload,
      kdfParams: {
        ...validPayload.kdfParams,
        memoryKiB: 32 * 1024,
      },
    }),
    /too small/i,
  )

  assert.throws(
    () => parsePasswordVaultUserKeyPayload({
      ...validPayload,
      kdfParams: {
        ...validPayload.kdfParams,
        iterations: 2,
      },
    }),
    /too small/i,
  )
})

test('password vault user-key serialization omits internal ownership fields', () => {
  const response = serializePasswordVaultUserKey({
    ...userKeyRecord(),
    userId: 'user_123',
    organisationId: 'org_123',
  })

  assert.deepEqual(response, {
    configured: true,
    publicKey: validPayload.publicKey,
    encryptedPrivateKeyEnvelope: validPayload.encryptedPrivateKeyEnvelope,
    kdfParams: validPayload.kdfParams,
    envelopeVersion: PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION,
    setupCompletedAt: '2026-05-04T15:00:00.000Z',
    updatedAt: '2026-05-04T15:05:00.000Z',
  })
  assert.equal('userId' in response, false)
  assert.equal('organisationId' in response, false)
})

test('password vault user-key serialization rejects unsupported envelope versions', () => {
  assert.throws(
    () => serializePasswordVaultUserKey(userKeyRecord({ envelopeVersion: 'private-key-envelope:v0' })),
    /unsupported/i,
  )
})

test('password vault user-key conflict response is generic', () => {
  assert.deepEqual(createPasswordVaultUserKeyConflictResponse(), {
    message: 'Password Vault has already been set up for this user.',
  })
})
