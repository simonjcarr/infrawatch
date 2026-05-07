import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBetterAuthSessionCookieName,
  shouldUseSecureSessionCookie,
} from './session-cookie.ts'

test('manual session cookies use Better Auth secure prefix for HTTPS deployments', () => {
  assert.equal(shouldUseSecureSessionCookie('https://ct-ops/api/auth', 'development'), true)
  assert.equal(getBetterAuthSessionCookieName('https://ct-ops/api/auth', 'development'), '__Secure-better-auth.session_token')
})

test('manual session cookies keep the local development cookie name for HTTP', () => {
  assert.equal(shouldUseSecureSessionCookie('http://localhost:3000/api/auth', 'development'), false)
  assert.equal(getBetterAuthSessionCookieName('http://localhost:3000/api/auth', 'development'), 'better-auth.session_token')
})

test('manual session cookies are secure in production even when URL parsing is unavailable', () => {
  assert.equal(shouldUseSecureSessionCookie('http://ct-ops/api/auth', 'production'), true)
  assert.equal(getBetterAuthSessionCookieName('http://ct-ops/api/auth', 'production'), '__Secure-better-auth.session_token')
})
