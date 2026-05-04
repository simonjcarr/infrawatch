import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
  createPasswordVaultEntryDeletedResponse,
  parseCreatePasswordVaultEntryPayload,
  parseUpdatePasswordVaultEntryPayload,
  serializePasswordVaultEntry,
} from './entry-api.ts'

const encryptedPayloadEnvelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  iv: 'entryPayloadIv01',
  ciphertext: 'entryPayloadCiphertext000000000000000000000000',
}

const encryptedDisplayEnvelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  iv: 'entryDisplayIv01',
  ciphertext: 'entryDisplayCiphertext000000000000000000000000',
}

const createPayload = {
  encryptedPayloadEnvelope,
  encryptedDisplayEnvelope,
  envelopeVersion: PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
}

function entryRecord(overrides = {}) {
  return {
    id: 'entry_123',
    vaultId: 'vault_123',
    encryptedPayloadEnvelope,
    encryptedDisplayEnvelope,
    envelopeVersion: PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
    createdAt: new Date('2026-05-04T17:00:00.000Z'),
    updatedAt: new Date('2026-05-04T17:05:00.000Z'),
    ...overrides,
  }
}

test('password vault entry create payload accepts only encrypted entry material', () => {
  assert.deepEqual(parseCreatePasswordVaultEntryPayload(createPayload), createPayload)

  assert.throws(
    () => parseCreatePasswordVaultEntryPayload({
      ...createPayload,
      title: 'Production SSH',
    }),
    /unrecognized key/i,
  )

  assert.throws(
    () => parseCreatePasswordVaultEntryPayload({
      ...createPayload,
      password: 'plaintext-secret',
    }),
    /unrecognized key/i,
  )

  assert.throws(
    () => parseCreatePasswordVaultEntryPayload({
      ...createPayload,
      encryptedPayloadEnvelope: {
        ...encryptedPayloadEnvelope,
        username: 'root',
      },
    }),
    /unrecognized key/i,
  )
})

test('password vault entry update payload rejects plaintext-shaped fields', () => {
  assert.deepEqual(parseUpdatePasswordVaultEntryPayload({
    encryptedPayloadEnvelope,
    encryptedDisplayEnvelope,
  }), {
    encryptedPayloadEnvelope,
    encryptedDisplayEnvelope,
  })

  assert.throws(
    () => parseUpdatePasswordVaultEntryPayload({
      encryptedPayloadEnvelope,
      encryptedDisplayEnvelope,
      url: 'https://example.test',
    }),
    /unrecognized key/i,
  )
})

test('password vault entry serialization excludes organisation and audit internals', () => {
  const response = serializePasswordVaultEntry({
    ...entryRecord(),
    organisationId: 'org_123',
    createdByUserId: 'user_123',
    updatedByUserId: 'user_123',
  })

  assert.deepEqual(response, {
    id: 'entry_123',
    vaultId: 'vault_123',
    encryptedPayloadEnvelope,
    encryptedDisplayEnvelope,
    envelopeVersion: PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
    createdAt: '2026-05-04T17:00:00.000Z',
    updatedAt: '2026-05-04T17:05:00.000Z',
  })
  assert.equal('organisationId' in response, false)
  assert.equal('createdByUserId' in response, false)
  assert.equal('updatedByUserId' in response, false)
})

test('password vault entry serialization validates stored envelope version', () => {
  assert.throws(
    () => serializePasswordVaultEntry(entryRecord({ envelopeVersion: 'vault-entry-envelope:v0' })),
    /unsupported/i,
  )
})

test('password vault entry delete response is generic and contains no encrypted material', () => {
  assert.deepEqual(createPasswordVaultEntryDeletedResponse('entry_123'), {
    id: 'entry_123',
    deleted: true,
  })
})
