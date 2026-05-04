import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_DISPLAY_ENVELOPE_VERSION,
  PASSWORD_VAULT_KEY_WRAP_VERSION,
  createPasswordVaultDeletedResponse,
  parseCreatePasswordVaultPayload,
  parseUpdatePasswordVaultPayload,
  serializePasswordVault,
} from './vault-api.ts'

const encryptedDisplayEnvelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  iv: 'vaultDisplayIv01',
  ciphertext: 'vaultDisplayCiphertext000000000000000000000000',
}

const wrappedVaultKeyEnvelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  iv: 'vaultWrappedIv01',
  ciphertext: 'vaultWrappedCiphertext000000000000000000000000',
  wrapVersion: 1,
  salt: 'vaultWrapSalt0000',
}

const createPayload = {
  encryptedDisplayEnvelope,
  wrappedVaultKeyEnvelope,
  displayEnvelopeVersion: PASSWORD_VAULT_DISPLAY_ENVELOPE_VERSION,
  keyWrapVersion: PASSWORD_VAULT_KEY_WRAP_VERSION,
}

function vaultRecord(overrides = {}) {
  return {
    id: 'vault_123',
    encryptedDisplayEnvelope,
    status: 'active',
    createdAt: new Date('2026-05-04T16:00:00.000Z'),
    updatedAt: new Date('2026-05-04T16:05:00.000Z'),
    memberRole: 'owner',
    wrappedVaultKeyEnvelope,
    keyEpochId: 'epoch_123',
    keyEpochNumber: 1,
    keyWrapVersion: PASSWORD_VAULT_KEY_WRAP_VERSION,
    ...overrides,
  }
}

test('password vault create payload accepts only encrypted vault material', () => {
  assert.deepEqual(parseCreatePasswordVaultPayload(createPayload), createPayload)

  assert.throws(
    () => parseCreatePasswordVaultPayload({
      ...createPayload,
      name: 'Production passwords',
    }),
    /unrecognized key/i,
  )

  assert.throws(
    () => parseCreatePasswordVaultPayload({
      ...createPayload,
      encryptedDisplayEnvelope: {
        ...encryptedDisplayEnvelope,
        title: 'plaintext vault title',
      },
    }),
    /unrecognized key/i,
  )
})

test('password vault update payload rejects plaintext-shaped fields', () => {
  assert.deepEqual(parseUpdatePasswordVaultPayload({ encryptedDisplayEnvelope }), {
    encryptedDisplayEnvelope,
  })

  assert.throws(
    () => parseUpdatePasswordVaultPayload({
      encryptedDisplayEnvelope,
      username: 'plaintext-owner',
    }),
    /unrecognized key/i,
  )
})

test('password vault serialization exposes current-user membership without organisation internals', () => {
  const response = serializePasswordVault({
    ...vaultRecord(),
    organisationId: 'org_123',
    createdByUserId: 'user_123',
  })

  assert.deepEqual(response, {
    id: 'vault_123',
    encryptedDisplayEnvelope,
    status: 'active',
    currentUserRole: 'owner',
    wrappedVaultKeyEnvelope,
    keyEpoch: {
      id: 'epoch_123',
      epochNumber: 1,
      wrapVersion: PASSWORD_VAULT_KEY_WRAP_VERSION,
    },
    createdAt: '2026-05-04T16:00:00.000Z',
    updatedAt: '2026-05-04T16:05:00.000Z',
  })
  assert.equal('organisationId' in response, false)
  assert.equal('createdByUserId' in response, false)
})

test('password vault serialization validates stored envelope versions', () => {
  assert.throws(
    () => serializePasswordVault(vaultRecord({ keyWrapVersion: 'vault-key-wrap:v0' })),
    /unsupported/i,
  )
})

test('password vault delete response is generic and contains no encrypted material', () => {
  assert.deepEqual(createPasswordVaultDeletedResponse('vault_123'), {
    id: 'vault_123',
    deleted: true,
  })
})
