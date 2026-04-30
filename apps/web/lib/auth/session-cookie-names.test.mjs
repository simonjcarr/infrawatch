import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SESSION_COOKIE_NAMES,
  hasBetterAuthSessionCookie,
} from './session-cookie-names.ts'

function cookies(names) {
  const values = new Map(names.map((name) => [name, { name, value: 'token' }]))
  return {
    get(name) {
      return values.get(name)
    },
  }
}

test('proxy recognises Better Auth session cookie variants', () => {
  assert.deepEqual(SESSION_COOKIE_NAMES, [
    'better-auth.session_token',
    '__Secure-better-auth.session_token',
    '__Host-better-auth.session_token',
  ])

  assert.equal(hasBetterAuthSessionCookie(cookies(['better-auth.session_token'])), true)
  assert.equal(hasBetterAuthSessionCookie(cookies(['__Secure-better-auth.session_token'])), true)
  assert.equal(hasBetterAuthSessionCookie(cookies(['__Host-better-auth.session_token'])), true)
  assert.equal(hasBetterAuthSessionCookie(cookies(['other'])), false)
})
