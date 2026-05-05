import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEncryptedVaultMetadata,
  createEncryptedEntryPayload,
  createUnlockProfile,
  decryptVaultMetadata,
  decryptEntryPayload,
  decryptUserPrivateKeyEnvelope,
  exportPublicKeyEnvelope,
  generateVaultKey,
  unwrapVaultKeyEnvelope,
  wrapVaultKeyForMember,
} from './browser-crypto.ts'

test('unlock profile generation and decrypt round-trip stays browser-only', async () => {
  const profile = await createUnlockProfile('correct horse battery staple')
  const decrypted = await decryptUserPrivateKeyEnvelope({
    unlockPassword: 'correct horse battery staple',
    encryptedPrivateKeyEnvelope: profile.encryptedPrivateKeyEnvelope,
    kdfMetadata: profile.kdfMetadata,
  })

  assert.equal(profile.kdfMetadata.algorithm, 'pbkdf2-sha256')
  assert.equal(profile.kdfMetadata.derived_key_length, 32)
  assert.equal(profile.publicKey.algorithm.name, 'RSA-OAEP')
  assert.equal(decrypted.privateKey.algorithm.name, 'RSA-OAEP')
})

test('decryptUserPrivateKeyEnvelope rejects invalid unlock secrets without exposing plaintext', async () => {
  const profile = await createUnlockProfile('correct horse battery staple')

  await assert.rejects(
    () =>
      decryptUserPrivateKeyEnvelope({
        unlockPassword: 'wrong battery horse staple',
        encryptedPrivateKeyEnvelope: profile.encryptedPrivateKeyEnvelope,
        kdfMetadata: profile.kdfMetadata,
      }),
    /operation/i,
  )
})

test('vault key wrapping and entry encryption round-trip', async () => {
  const owner = await createUnlockProfile('owner password')
  const ownerKeys = await decryptUserPrivateKeyEnvelope({
    unlockPassword: 'owner password',
    encryptedPrivateKeyEnvelope: owner.encryptedPrivateKeyEnvelope,
    kdfMetadata: owner.kdfMetadata,
  })

  const vaultKey = await generateVaultKey()
  const wrappedVaultKeyEnvelope = await wrapVaultKeyForMember(vaultKey, owner.publicKey)
  const unwrappedVaultKey = await unwrapVaultKeyEnvelope(
    wrappedVaultKeyEnvelope,
    ownerKeys.privateKey,
  )
  const encryptedPayload = await createEncryptedEntryPayload(
    {
      title: 'Database root password',
      username: 'postgres',
      password: 'super-secret',
    },
    unwrappedVaultKey,
  )
  const decryptedPayload = await decryptEntryPayload(encryptedPayload, unwrappedVaultKey)

  assert.equal(wrappedVaultKeyEnvelope.algorithm, 'rsa-oaep-256')
  assert.equal(encryptedPayload.algorithm, 'aes-256-gcm')
  assert.deepEqual(decryptedPayload, {
    title: 'Database root password',
    username: 'postgres',
    password: 'super-secret',
  })
})

test('vault metadata encryption round-trip stays client-side', async () => {
  const vaultKey = await generateVaultKey()
  const encryptedMetadata = await createEncryptedVaultMetadata(
    {
      name: 'Shared production',
      description: 'Operator secrets',
    },
    vaultKey,
  )
  const decryptedMetadata = await decryptVaultMetadata(encryptedMetadata, vaultKey)

  assert.equal(encryptedMetadata.algorithm, 'aes-256-gcm')
  assert.deepEqual(decryptedMetadata, {
    name: 'Shared production',
    description: 'Operator secrets',
  })
})

test('exportPublicKeyEnvelope returns a portable encrypted member key target', async () => {
  const profile = await createUnlockProfile('member password')
  const publicKeyEnvelope = await exportPublicKeyEnvelope(profile.publicKey)

  assert.equal(publicKeyEnvelope.version, 1)
  assert.equal(publicKeyEnvelope.algorithm, 'rsa-oaep-256')
  assert.equal(typeof publicKeyEnvelope.public_key_spki_b64, 'string')
  assert.equal(publicKeyEnvelope.public_key_spki_b64.length > 0, true)
})
