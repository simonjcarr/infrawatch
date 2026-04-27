import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertProductionAuthEnv,
  getBetterAuthOrigin,
  getBetterAuthSecret,
  getBetterAuthUrl,
  getRequireEmailVerification,
} from './env.ts'

test('getBetterAuthSecret rejects missing values', () => {
  assert.throws(() => getBetterAuthSecret({}), /BETTER_AUTH_SECRET must be set/)
})

test('getBetterAuthUrl rejects missing or invalid values', () => {
  assert.throws(() => getBetterAuthUrl({}), /BETTER_AUTH_URL must be set/)
  assert.throws(
    () => getBetterAuthUrl({ BETTER_AUTH_URL: 'not-a-url' }),
    /BETTER_AUTH_URL must be a valid absolute URL/,
  )
})

test('getBetterAuthOrigin normalises BETTER_AUTH_URL to an origin', () => {
  assert.equal(
    getBetterAuthOrigin({ BETTER_AUTH_URL: 'https://ct-ops.example.com/login?next=%2Fdashboard' }),
    'https://ct-ops.example.com',
  )
})

test('getRequireEmailVerification defaults to requiring verification', () => {
  assert.equal(getRequireEmailVerification({}), true)
})

test('getRequireEmailVerification parses explicit boolean values', () => {
  assert.equal(getRequireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: 'true' }), true)
  assert.equal(getRequireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: '1' }), true)
  assert.equal(getRequireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: 'false' }), false)
  assert.equal(getRequireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: '0' }), false)
})

test('getRequireEmailVerification rejects invalid values', () => {
  assert.throws(
    () => getRequireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: 'sometimes' }),
    /REQUIRE_EMAIL_VERIFICATION must be either true or false/,
  )
})

test('assertProductionAuthEnv rejects short secrets and localhost URLs', () => {
  assert.throws(
    () =>
      assertProductionAuthEnv({
        BETTER_AUTH_SECRET: 'too-short',
        BETTER_AUTH_URL: 'https://ct-ops.example.com',
      }),
    /BETTER_AUTH_SECRET must be set to a random string of at least 32 characters in production/,
  )

  assert.throws(
    () =>
      assertProductionAuthEnv({
        BETTER_AUTH_SECRET: '01234567890123456789012345678901',
        BETTER_AUTH_URL: 'http://localhost:3000',
      }),
    /BETTER_AUTH_URL must be set to the public URL of this deployment in production/,
  )
})
