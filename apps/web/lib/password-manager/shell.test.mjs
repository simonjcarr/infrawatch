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
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: null,
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: false,
    unlockError: null,
    unlockMetadata: null,
    view: 'locked',
  })
})

test('setup completion stores encrypted materials and unlocks without persisting plaintext', () => {
  const initial = reducePasswordManagerShellState(createInitialPasswordManagerShellState('org-alpha'), {
    type: 'launch-succeeded',
    setupConfigured: false,
  })
  const keyPair = { privateKey: { kind: 'private' }, publicKey: { kind: 'public' } }
  const next = reducePasswordManagerShellState(initial, {
    type: 'setup-succeeded',
    encryptedPrivateKeyEnvelope: { ciphertext_b64: 'ciphertext' },
    kdfMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    keyPair,
  })

  assert.deepEqual(next, {
    organisationId: 'org-alpha',
    activeKeyPair: keyPair,
    encryptedPrivateKeyEnvelope: { ciphertext_b64: 'ciphertext' },
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: true,
    unlockError: null,
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'unlocked',
  })
})

test('manual lock clears decrypted key material without forcing setup again', () => {
  const unlocked = {
    organisationId: 'org-alpha',
    activeKeyPair: { privateKey: { kind: 'private' }, publicKey: { kind: 'public' } },
    encryptedPrivateKeyEnvelope: { ciphertext_b64: 'ciphertext' },
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: true,
    unlockError: null,
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'unlocked',
  }

  const next = reducePasswordManagerShellState(unlocked, { type: 'lock' })

  assert.deepEqual(next, {
    organisationId: 'org-alpha',
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: { ciphertext_b64: 'ciphertext' },
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: true,
    unlockError: null,
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'locked',
  })
})

test('generic unlock failures keep the shell locked and avoid revealing the root cause', () => {
  const locked = {
    organisationId: 'org-alpha',
    activeKeyPair: { privateKey: { kind: 'private' }, publicKey: { kind: 'public' } },
    encryptedPrivateKeyEnvelope: null,
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: true,
    unlockError: null,
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'unlocked',
  }

  const next = reducePasswordManagerShellState(locked, {
    type: 'unlock-failed',
    message: 'Password Manager could not unlock with the provided materials. Retry or relaunch.',
    needsRelaunch: true,
  })

  assert.deepEqual(next, {
    organisationId: 'org-alpha',
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: null,
    launchNonce: 0,
    needsRelaunch: true,
    setupError: null,
    setupConfigured: true,
    unlockError: 'Password Manager could not unlock with the provided materials. Retry or relaunch.',
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'locked',
  })
})

test('organisation changes tear down local state and restart launch', () => {
  const locked = {
    organisationId: 'org-alpha',
    activeKeyPair: { privateKey: { kind: 'private' }, publicKey: { kind: 'public' } },
    encryptedPrivateKeyEnvelope: { ciphertext_b64: 'ciphertext' },
    launchNonce: 0,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: true,
    unlockError: null,
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'unlocked',
  }

  const next = reducePasswordManagerShellState(locked, {
    type: 'organisation-changed',
    organisationId: 'org-bravo',
  })

  assert.deepEqual(next, {
    organisationId: 'org-bravo',
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: null,
    launchNonce: 1,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: null,
    unlockError: null,
    unlockMetadata: null,
    view: 'launching',
  })
})

test('explicit relaunch clears local shell state and increments launch nonce', () => {
  const locked = {
    organisationId: 'org-alpha',
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: { ciphertext_b64: 'ciphertext' },
    launchNonce: 3,
    needsRelaunch: true,
    setupError: null,
    setupConfigured: true,
    unlockError: 'Password Manager could not unlock with the provided materials. Retry or relaunch.',
    unlockMetadata: { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: 'salt', derived_key_length: 32 },
    view: 'locked',
  }

  const next = reducePasswordManagerShellState(locked, { type: 'restart-launch' })

  assert.deepEqual(next, {
    organisationId: 'org-alpha',
    activeKeyPair: null,
    encryptedPrivateKeyEnvelope: null,
    launchNonce: 4,
    needsRelaunch: false,
    setupError: null,
    setupConfigured: null,
    unlockError: null,
    unlockMetadata: null,
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
