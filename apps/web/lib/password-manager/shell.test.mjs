import test from 'node:test'
import assert from 'node:assert/strict'

import { PasswordManagerApiError } from './client.ts'
import {
  createInitialPasswordManagerShellState,
  mapPasswordManagerErrorToShellView,
  reducePasswordManagerShellState,
} from './shell.ts'

test('launch success enters the locked shell and records setup status', () => {
  const initial = createInitialPasswordManagerShellState('org-alpha')
  const next = reducePasswordManagerShellState(initial, {
    type: 'launch-succeeded',
    setupConfigured: false,
  })

  assert.deepEqual(next, {
    organisationId: 'org-alpha',
    launchNonce: 0,
    setupConfigured: false,
    view: 'locked',
  })
})

test('organisation changes tear down local state and restart launch', () => {
  const locked = {
    organisationId: 'org-alpha',
    launchNonce: 0,
    setupConfigured: true,
    view: 'unlocked',
  }

  const next = reducePasswordManagerShellState(locked, {
    type: 'organisation-changed',
    organisationId: 'org-bravo',
  })

  assert.deepEqual(next, {
    organisationId: 'org-bravo',
    launchNonce: 1,
    setupConfigured: null,
    view: 'launching',
  })
})

test('explicit relaunch clears local shell state and increments launch nonce', () => {
  const locked = {
    organisationId: 'org-alpha',
    launchNonce: 3,
    setupConfigured: true,
    view: 'locked',
  }

  const next = reducePasswordManagerShellState(locked, { type: 'restart-launch' })

  assert.deepEqual(next, {
    organisationId: 'org-alpha',
    launchNonce: 4,
    setupConfigured: null,
    view: 'launching',
  })
})

test('API errors map to safe shell views', () => {
  assert.equal(
    mapPasswordManagerErrorToShellView(new PasswordManagerApiError(401, 'session_expired')),
    'session-expired',
  )
  assert.equal(
    mapPasswordManagerErrorToShellView(new PasswordManagerApiError(403, 'forbidden')),
    'access-denied',
  )
  assert.equal(
    mapPasswordManagerErrorToShellView(new PasswordManagerApiError(404, 'not_found')),
    'object-unavailable',
  )
  assert.equal(
    mapPasswordManagerErrorToShellView(new PasswordManagerApiError(503, 'upstream_error')),
    'operational-failure',
  )
  assert.equal(
    mapPasswordManagerErrorToShellView(new Error('network failure')),
    'operational-failure',
  )
})
