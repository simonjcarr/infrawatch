import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertTrustedMutationOrigin,
  getTrustedOriginHosts,
  getTrustedOrigins,
  isTrustedMutationOrigin,
} from './trusted-origins.ts'

test('getTrustedOrigins normalises BETTER_AUTH_URL and additional origins', () => {
  const env = {
    BETTER_AUTH_URL: 'https://ct-ops.example.com/login',
    BETTER_AUTH_TRUSTED_ORIGINS:
      'https://proxy.example.com, invalid-origin, https://ct-ops.example.com',
  }

  assert.deepEqual(getTrustedOrigins(env), [
    'https://ct-ops.example.com',
    'https://proxy.example.com',
  ])
})

test('getTrustedOrigins rejects missing BETTER_AUTH_URL instead of silently using localhost', () => {
  assert.throws(() => getTrustedOrigins({}), /BETTER_AUTH_URL must be set/)
})

test('getTrustedOriginHosts keeps the host:port values expected by Next serverActions.allowedOrigins', () => {
  const env = {
    BETTER_AUTH_URL: 'https://ct-ops.example.com',
    BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3001,https://proxy.example.com',
  }

  assert.deepEqual(getTrustedOriginHosts(env), [
    'ct-ops.example.com',
    'localhost:3001',
    'proxy.example.com',
  ])
})

test('isTrustedMutationOrigin accepts a trusted Origin header', () => {
  const headers = new Headers({
    origin: 'https://ct-ops.example.com',
  })

  assert.equal(
    isTrustedMutationOrigin(headers, {
      BETTER_AUTH_URL: 'https://ct-ops.example.com',
    }),
    true,
  )
})

test('isTrustedMutationOrigin falls back to Referer when Origin is absent', () => {
  const headers = new Headers({
    referer: 'https://proxy.example.com/settings/profile',
  })

  assert.equal(
    isTrustedMutationOrigin(headers, {
      BETTER_AUTH_URL: 'https://ct-ops.example.com',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://proxy.example.com',
    }),
    true,
  )
})

test('assertTrustedMutationOrigin rejects missing or untrusted origins', () => {
  assert.throws(
    () =>
      assertTrustedMutationOrigin(
        new Headers(),
        { BETTER_AUTH_URL: 'https://ct-ops.example.com' },
      ),
    /forbidden: invalid request origin/,
  )

  assert.throws(
    () =>
      assertTrustedMutationOrigin(
        new Headers({ origin: 'https://evil.example.com' }),
        { BETTER_AUTH_URL: 'https://ct-ops.example.com' },
      ),
    /forbidden: invalid request origin/,
  )
})
