import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { exportSPKI, importSPKI, jwtVerify } from 'jose'

import {
  PASSWORD_MANAGER_LAUNCH_ASSERTION_TTL_SECONDS,
  getPasswordManagerLaunchAssertionConfig,
  signPasswordManagerLaunchAssertion,
} from './launch-assertion.ts'

function createLaunchKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyDerBase64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey,
  }
}

test('getPasswordManagerLaunchAssertionConfig falls back to auth URL and defaults', () => {
  const { privateKeyDerBase64 } = createLaunchKeyPair()

  const config = getPasswordManagerLaunchAssertionConfig({
    BETTER_AUTH_URL: 'https://ct-ops.example.com/login?next=%2Fdashboard',
    CT_OPS_INSTANCE_ID: 'ct-ops-prod-1',
    PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY: privateKeyDerBase64,
  })

  assert.equal(config.issuer, 'https://ct-ops.example.com/login?next=%2Fdashboard')
  assert.equal(config.audience, 'ct-password-manager')
  assert.equal(config.product, 'ct-password-manager')
  assert.equal(config.ctOpsInstanceId, 'ct-ops-prod-1')
  assert.equal(config.ttlSeconds, PASSWORD_MANAGER_LAUNCH_ASSERTION_TTL_SECONDS)
})

test('getPasswordManagerLaunchAssertionConfig rejects missing required launch config', () => {
  assert.throws(
    () =>
      getPasswordManagerLaunchAssertionConfig({
        BETTER_AUTH_URL: 'https://ct-ops.example.com',
      }),
    /CT_OPS_INSTANCE_ID must be set/,
  )
})

test('signPasswordManagerLaunchAssertion emits the required claims', async () => {
  const { privateKeyDerBase64, publicKey } = createLaunchKeyPair()
  const config = getPasswordManagerLaunchAssertionConfig({
    BETTER_AUTH_URL: 'https://ct-ops.example.com',
    CT_OPS_INSTANCE_ID: 'ct-ops-prod-1',
    PASSWORD_MANAGER_CT_OPS_AUDIENCE: 'ct-password-manager',
    PASSWORD_MANAGER_CT_OPS_PRODUCT: 'ct-password-manager',
    PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY: privateKeyDerBase64,
  })

  const assertion = await signPasswordManagerLaunchAssertion(
    {
      instanceId: 'instance-123',
      instanceName: 'Example Instance',
      userId: 'user-456',
      email: 'ops@example.com',
      name: 'Example Operator',
    },
    { config, now: new Date('2026-05-05T17:45:00.000Z'), jti: 'nonce-123' },
  )

  const verifier = await importSPKI(await exportSPKI(publicKey), 'EdDSA')
  const { payload, protectedHeader } = await jwtVerify(assertion, verifier, {
    algorithms: ['EdDSA'],
    issuer: config.issuer,
    audience: config.audience,
    currentDate: new Date('2026-05-05T17:45:30.000Z'),
  })

  assert.equal(protectedHeader.alg, 'EdDSA')
  assert.equal(payload.product, 'ct-password-manager')
  assert.equal(payload.ct_ops_instance_id, 'ct-ops-prod-1')
  assert.equal(payload.ct_ops_instance_settings_id, 'instance-123')
  assert.equal(payload.ct_ops_instance_name, 'Example Instance')
  assert.equal(payload.ct_ops_user_id, 'user-456')
  assert.equal(payload.email, 'ops@example.com')
  assert.equal(payload.name, 'Example Operator')
  assert.equal(payload.jti, 'nonce-123')
  assert.equal(payload.iat, 1778003100)
  assert.equal(payload.exp, 1778003100 + PASSWORD_MANAGER_LAUNCH_ASSERTION_TTL_SECONDS)
})

test('signPasswordManagerLaunchAssertion omits the optional instance name when absent', async () => {
  const { privateKeyDerBase64, publicKey } = createLaunchKeyPair()
  const config = getPasswordManagerLaunchAssertionConfig({
    BETTER_AUTH_URL: 'https://ct-ops.example.com',
    CT_OPS_INSTANCE_ID: 'ct-ops-prod-1',
    PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY: privateKeyDerBase64,
  })

  const assertion = await signPasswordManagerLaunchAssertion(
    {
      instanceId: 'instance-123',
      userId: 'user-456',
      email: 'ops@example.com',
      name: 'Example Operator',
    },
    { config, now: new Date('2026-05-05T17:45:00.000Z'), jti: 'nonce-456' },
  )

  const verifier = await importSPKI(await exportSPKI(publicKey), 'EdDSA')
  const { payload } = await jwtVerify(assertion, verifier, {
    algorithms: ['EdDSA'],
    issuer: config.issuer,
    audience: config.audience,
    currentDate: new Date('2026-05-05T17:45:30.000Z'),
  })

  assert.equal('ct_ops_instance_name' in payload, false)
})
