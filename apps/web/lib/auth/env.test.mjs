import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertProductionAuthEnv,
  getBetterAuthOrigin,
  getBetterAuthSecret,
  getBetterAuthUrl,
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
