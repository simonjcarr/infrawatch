import test from 'node:test'
import assert from 'node:assert/strict'

import { PasswordManagerApiError } from './client.ts'
import {
  normalizePasswordManagerUiError,
  shouldLogPasswordManagerError,
} from './errors.ts'

test('normalizePasswordManagerUiError maps expected API statuses to safe states and messages', () => {
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(400, 'bad_request'), 'fallback'),
    {
      kind: 'message',
      message: 'Password Manager rejected that request. Refresh the workspace and retry.',
    },
  )
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(401, 'session_expired'), 'fallback'),
    {
      kind: 'shell-view',
      message: 'Your Password Manager session expired. Relaunch and try again.',
      view: 'session-expired',
    },
  )
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(403, 'forbidden'), 'fallback'),
    {
      kind: 'shell-view',
      message: 'Your current session cannot access Password Manager. Relaunch or switch organisation access.',
      view: 'access-denied',
    },
  )
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(404, 'not_found'), 'fallback'),
    {
      kind: 'object-unavailable',
      message: 'The requested vault or entry is no longer available. Refresh the workspace and try again.',
      view: 'object-unavailable',
    },
  )
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(409, 'membership_conflict'), 'fallback'),
    {
      kind: 'message',
      message: 'Password Manager rejected that change because the current state changed. Refresh and retry.',
    },
  )
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(429, 'rate_limited'), 'fallback'),
    {
      kind: 'message',
      message: 'Password Manager rate limited that action. Wait a moment and retry.',
    },
  )
  assert.deepEqual(
    normalizePasswordManagerUiError(new PasswordManagerApiError(503, 'unavailable'), 'fallback'),
    {
      kind: 'shell-view',
      message: 'Password Manager is temporarily unavailable. Retry shortly.',
      view: 'operational-failure',
    },
  )
})

test('normalizePasswordManagerUiError preserves the local fallback for non-API failures', () => {
  assert.deepEqual(
    normalizePasswordManagerUiError(new Error('clipboard unavailable'), 'The password could not be copied safely in this browser.'),
    {
      kind: 'message',
      message: 'The password could not be copied safely in this browser.',
    },
  )
})

test('shouldLogPasswordManagerError suppresses expected API control-flow errors', () => {
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(400, 'bad_request')), false)
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(401, 'session_expired')), false)
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(403, 'forbidden')), false)
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(404, 'not_found')), false)
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(409, 'membership_conflict')), false)
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(429, 'rate_limited')), false)
  assert.equal(shouldLogPasswordManagerError(new PasswordManagerApiError(500, 'unavailable')), true)
  assert.equal(shouldLogPasswordManagerError(new Error('network failure')), true)
})
