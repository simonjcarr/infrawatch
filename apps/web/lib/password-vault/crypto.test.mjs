import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PASSWORD_VAULT_KDF_PARAMS,
  createPasswordVaultKdfParams,
  createUserPrivateKeyEnvelope,
  decryptVaultPayload,
  derivePasswordVaultUnlockKey,
  encryptVaultPayload,
  generatePasswordVaultKey,
  generatePasswordVaultSharingKeyPair,
  serialisePasswordVaultKdfParams,
  unwrapPasswordVaultKey,
  wrapPasswordVaultKey,
} from './crypto.ts'

test('password vault KDF params round-trip through serialisation', () => {
  const params = createPasswordVaultKdfParams('vault-kdf-salt')

  assert.deepEqual(
    params,
    {
      ...DEFAULT_PASSWORD_VAULT_KDF_PARAMS,
      salt: 'vault-kdf-salt',
    },
  )

  const serialised = serialisePasswordVaultKdfParams(params)

  assert.equal(typeof serialised, 'string')
  assert.deepEqual(JSON.parse(serialised), params)
})

test('password vault private key envelopes reject the wrong unlock password', async () => {
  const setup = await createUserPrivateKeyEnvelope('correct horse battery staple')

  await assert.rejects(
    () => setup.decryptPrivateKey('wrong password'),
    /unlock/i,
  )

  const privateKey = await setup.decryptPrivateKey('correct horse battery staple')
  const exported = await crypto.subtle.exportKey('jwk', privateKey)

  assert.equal(exported.kty, 'EC')
  assert.equal(exported.crv, 'P-256')
})

test('password vault payload decryption rejects tampered AES-GCM envelopes', async () => {
  const vaultKey = await generatePasswordVaultKey()
  const payload = {
    title: 'Prod root',
    username: 'root',
    password: 'super-secret',
  }

  const envelope = await encryptVaultPayload(vaultKey, payload)
  const tampered = {
    ...envelope,
    ciphertext: `${envelope.ciphertext.slice(0, -2)}AA`,
  }

  await assert.rejects(
    () => decryptVaultPayload(vaultKey, tampered),
    /decrypt|authenticate|cipher/i,
  )
})

test('password vault payload encryption uses a fresh nonce each time', async () => {
  const vaultKey = await generatePasswordVaultKey()
  const payload = { title: 'VPN', password: 'same-secret' }

  const first = await encryptVaultPayload(vaultKey, payload)
  const second = await encryptVaultPayload(vaultKey, payload)

  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.ciphertext, second.ciphertext)
})

test('password vault keys can be wrapped for a recipient and unwrapped by that recipient', async () => {
  const vaultKey = await generatePasswordVaultKey()
  const author = await generatePasswordVaultSharingKeyPair()
  const recipient = await generatePasswordVaultSharingKeyPair()
  const wrapped = await wrapPasswordVaultKey({
    vaultKey,
    senderPrivateKey: author.privateKey,
    recipientPublicKey: recipient.publicKey,
  })

  const unwrapped = await unwrapPasswordVaultKey({
    wrappedVaultKey: wrapped,
    recipientPrivateKey: recipient.privateKey,
    senderPublicKey: author.publicKey,
  })

  const payload = { title: 'Shared secret', password: 'rotates-later' }
  const encrypted = await encryptVaultPayload(vaultKey, payload)
  const decrypted = await decryptVaultPayload(unwrapped, encrypted)

  assert.deepEqual(decrypted, payload)
})

test('password vault envelopes do not serialise plaintext values', async () => {
  const vaultKey = await generatePasswordVaultKey()
  const payload = {
    title: 'Payroll',
    username: 'payroll-admin',
    password: 'plain-text-should-not-leak',
    notes: 'Contains highly sensitive credentials',
  }

  const envelope = await encryptVaultPayload(vaultKey, payload)
  const serialisedEnvelope = JSON.stringify(envelope)

  assert.equal(serialisedEnvelope.includes(payload.password), false)
  assert.equal(serialisedEnvelope.includes(payload.notes), false)

  const setup = await createUserPrivateKeyEnvelope('unlock-secret')
  const serialisedPrivateKeyEnvelope = JSON.stringify({
    envelope: setup.privateKeyEnvelope,
    params: setup.kdfParams,
  })

  assert.equal(serialisedPrivateKeyEnvelope.includes('unlock-secret'), false)
})

test('password vault unlock key derivation is deterministic for the same password and params', async () => {
  const params = createPasswordVaultKdfParams('repeatable-salt-1')
  const first = await derivePasswordVaultUnlockKey('vault-unlock', params)
  const second = await derivePasswordVaultUnlockKey('vault-unlock', params)

  assert.equal(first, second)
  assert.notEqual(first, 'vault-unlock')
})
