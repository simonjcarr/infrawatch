import test from 'node:test'
import assert from 'node:assert/strict'

import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose'

import {
  resetLicenceValidationStateForTests,
  validateLicenceKey,
} from './licence.ts'

const realFetch = globalThis.fetch
const realNodeEnv = process.env.NODE_ENV
const realPublicKey = process.env.LICENCE_PUBLIC_KEY
const realRevocationUrl = process.env.LICENCE_REVOCATION_URL

async function createKeyPair() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  }
}

async function signJwt(privateKeyPem, audience, claims = {}, options = {}) {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256')
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer('licence.carrtech.dev')
    .setAudience(audience)
    .setIssuedAt()
    .setNotBefore(0)
    .setExpirationTime(options.expirationTime ?? '1 hour')
    .sign(privateKey)
}

async function signLicence(privateKeyPem, claims = {}, options = {}) {
  return signJwt(
    privateKeyPem,
    'install.carrtech.dev',
    {
      tier: 'enterprise',
      features: ['whiteLabel'],
      customer: {
        name: 'Example Corp',
        email: 'ops@example.com',
      },
      sub: 'org_123',
      jti: 'lic_123',
      ...claims,
    },
    options,
  )
}

async function signRevocationBundle(privateKeyPem, revoked = []) {
  return signJwt(privateKeyPem, 'install.carrtech.dev/licence-revocations', { revoked })
}

test.afterEach(() => {
  resetLicenceValidationStateForTests()
  globalThis.fetch = realFetch

  if (realNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = realNodeEnv
  }

  if (realPublicKey === undefined) {
    delete process.env.LICENCE_PUBLIC_KEY
  } else {
    process.env.LICENCE_PUBLIC_KEY = realPublicKey
  }

  if (realRevocationUrl === undefined) {
    delete process.env.LICENCE_REVOCATION_URL
  } else {
    process.env.LICENCE_REVOCATION_URL = realRevocationUrl
  }
})

test('validateLicenceKey accepts a signed licence when the revocation list is unreachable', async () => {
  const keys = await createKeyPair()
  process.env.NODE_ENV = 'production'
  process.env.LICENCE_PUBLIC_KEY = keys.publicKeyPem
  process.env.LICENCE_REVOCATION_URL = 'https://licence.example.test/.well-known/ct-ops-licence-revocations.jwt'
  globalThis.fetch = async () => {
    throw new Error('network offline')
  }

  const key = await signLicence(keys.privateKeyPem)
  const result = await validateLicenceKey(key)

  assert.equal(result.valid, true)
})

test('validateLicenceKey preserves positive integer user seat capacity', async () => {
  const keys = await createKeyPair()
  process.env.NODE_ENV = 'production'
  process.env.LICENCE_PUBLIC_KEY = keys.publicKeyPem
  process.env.LICENCE_REVOCATION_URL = ''

  const key = await signLicence(keys.privateKeyPem, {
    maxUsers: 25,
    maxHosts: 500,
  })
  const result = await validateLicenceKey(key)

  assert.equal(result.valid, true)
  assert.equal(result.payload.maxUsers, 25)
  assert.equal(result.payload.maxHosts, 500)
})

test('validateLicenceKey ignores invalid capacity claims', async () => {
  const keys = await createKeyPair()
  process.env.NODE_ENV = 'production'
  process.env.LICENCE_PUBLIC_KEY = keys.publicKeyPem
  process.env.LICENCE_REVOCATION_URL = ''

  const key = await signLicence(keys.privateKeyPem, {
    maxUsers: 0,
    maxHosts: 12.5,
  })
  const result = await validateLicenceKey(key)

  assert.equal(result.valid, true)
  assert.equal(result.payload.maxUsers, undefined)
  assert.equal(result.payload.maxHosts, undefined)
})

test('validateLicenceKey rejects expired paid licences', async () => {
  const keys = await createKeyPair()
  process.env.NODE_ENV = 'production'
  process.env.LICENCE_PUBLIC_KEY = keys.publicKeyPem
  process.env.LICENCE_REVOCATION_URL = ''

  const key = await signLicence(keys.privateKeyPem, {}, { expirationTime: '1 second ago' })
  const result = await validateLicenceKey(key)

  assert.deepEqual(result, {
    valid: false,
    error: 'Licence key has expired',
  })
})

test('validateLicenceKey rejects a licence whose jti is present in the signed revocation bundle', async () => {
  const keys = await createKeyPair()
  process.env.NODE_ENV = 'production'
  process.env.LICENCE_PUBLIC_KEY = keys.publicKeyPem
  process.env.LICENCE_REVOCATION_URL = 'https://licence.example.test/.well-known/ct-ops-licence-revocations.jwt'
  globalThis.fetch = async () =>
    new Response(await signRevocationBundle(keys.privateKeyPem, ['lic_revoked']), {
      status: 200,
      headers: { 'content-type': 'application/jwt' },
    })

  const key = await signLicence(keys.privateKeyPem, { jti: 'lic_revoked' })
  const result = await validateLicenceKey(key)

  assert.deepEqual(result, {
    valid: false,
    error: 'Licence key has been revoked',
  })
})

test('validateLicenceKey caches the revocation bundle between validations', async () => {
  const keys = await createKeyPair()
  process.env.NODE_ENV = 'production'
  process.env.LICENCE_PUBLIC_KEY = keys.publicKeyPem
  process.env.LICENCE_REVOCATION_URL = 'https://licence.example.test/.well-known/ct-ops-licence-revocations.jwt'

  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(await signRevocationBundle(keys.privateKeyPem, []), {
      status: 200,
      headers: { 'content-type': 'application/jwt' },
    })
  }

  const firstKey = await signLicence(keys.privateKeyPem, { jti: 'lic_one' })
  const secondKey = await signLicence(keys.privateKeyPem, { jti: 'lic_two' })

  const first = await validateLicenceKey(firstKey)
  const second = await validateLicenceKey(secondKey)

  assert.equal(first.valid, true)
  assert.equal(second.valid, true)
  assert.equal(fetchCalls, 1)
})
