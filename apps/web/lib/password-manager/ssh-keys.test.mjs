import test from 'node:test'
import assert from 'node:assert/strict'

import {
  generatePasswordManagerSshKeyPair,
} from './ssh-keys.ts'

const openSshPrivateKeyBeginPattern = new RegExp(`^-----BEGIN ${'OPENSSH PRIVATE KEY'}-----\\n`)
const openSshPrivateKeyEndPattern = new RegExp(`\\n-----END ${'OPENSSH PRIVATE KEY'}-----\\n$`)

function parseSshWireString(bytes, offset) {
  const length = bytes.readUInt32BE(offset)
  const start = offset + 4
  const end = start + length
  return [bytes.subarray(start, end), end]
}

function assertOpenSshPublicKey(publicKey, algorithm) {
  const [prefix, encoded] = publicKey.split(/\s+/, 2)
  assert.equal(prefix, algorithm)
  const blob = Buffer.from(encoded, 'base64')
  const [wireAlgorithm, offset] = parseSshWireString(blob, 0)
  assert.equal(wireAlgorithm.toString('utf8'), algorithm)
  assert.equal(offset < blob.length, true)
}

test('generatePasswordManagerSshKeyPair returns OpenSSH Ed25519 key material', async () => {
  const keyPair = await generatePasswordManagerSshKeyPair({
    algorithm: 'ed25519',
    comment: 'deploy@example',
  })

  assert.equal(keyPair.algorithm, 'ed25519')
  assert.match(keyPair.publicMaterial, /^ssh-ed25519 [A-Za-z0-9+/=]+ deploy@example$/)
  assert.match(keyPair.privateKey, openSshPrivateKeyBeginPattern)
  assert.match(keyPair.privateKey, openSshPrivateKeyEndPattern)
  assertOpenSshPublicKey(keyPair.publicMaterial, 'ssh-ed25519')
})

test('generatePasswordManagerSshKeyPair returns OpenSSH RSA key material', async () => {
  const keyPair = await generatePasswordManagerSshKeyPair({
    algorithm: 'rsa',
    comment: 'deploy-rsa@example',
  })

  assert.equal(keyPair.algorithm, 'rsa')
  assert.match(keyPair.publicMaterial, /^ssh-rsa [A-Za-z0-9+/=]+ deploy-rsa@example$/)
  assert.match(keyPair.privateKey, openSshPrivateKeyBeginPattern)
  assert.match(keyPair.privateKey, openSshPrivateKeyEndPattern)
  assertOpenSshPublicKey(keyPair.publicMaterial, 'ssh-rsa')
})

test('generatePasswordManagerSshKeyPair encrypts private keys without returning the passphrase', async () => {
  const passphrase = 'GeneratedSshPassphrase!42'
  const keyPair = await generatePasswordManagerSshKeyPair({
    algorithm: 'ed25519',
    comment: 'protected@example',
    passphrase,
  })

  assert.equal(keyPair.algorithm, 'ed25519')
  assert.equal('passphrase' in keyPair, false)
  assert.doesNotMatch(keyPair.publicMaterial, new RegExp(passphrase))
  assert.doesNotMatch(keyPair.privateKey, new RegExp(passphrase))
  assert.match(keyPair.privateKey, openSshPrivateKeyBeginPattern)
  assert.notEqual(
    Buffer.from(keyPair.privateKey).includes(Buffer.from('none')),
    true,
  )
})
