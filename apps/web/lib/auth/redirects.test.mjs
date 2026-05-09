import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EXPIRED_SESSION_LOGIN_PATH,
  getAuthenticatedRedirectPath,
  shouldBypassAuthenticatedRedirect,
} from './redirects.ts'

test('authenticated redirect only accepts active non-deleted users', () => {
  assert.equal(getAuthenticatedRedirectPath({
    isActive: true,
    deletedAt: null,
  }), '/dashboard')

  assert.equal(getAuthenticatedRedirectPath({
    isActive: true,
    deletedAt: null,
  }), '/dashboard')

  assert.equal(getAuthenticatedRedirectPath({
    isActive: false,
    deletedAt: null,
  }), null)

  assert.equal(getAuthenticatedRedirectPath({
    isActive: true,
    deletedAt: new Date('2026-04-30T12:00:00.000Z'),
  }), null)
})

test('expired session login state bypasses auth-page redirect loops', () => {
  assert.equal(EXPIRED_SESSION_LOGIN_PATH, '/login?session=expired')
  assert.equal(shouldBypassAuthenticatedRedirect({ session: 'expired' }), true)
  assert.equal(shouldBypassAuthenticatedRedirect({ session: ['expired'] }), true)
  assert.equal(shouldBypassAuthenticatedRedirect({ session: 'fresh' }), false)
  assert.equal(shouldBypassAuthenticatedRedirect({}), false)
})
