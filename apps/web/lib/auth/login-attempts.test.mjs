import test from 'node:test'
import assert from 'node:assert/strict'

import { createLoginAttemptGuard } from './login-attempts.ts'

test('login attempt guard allows attempts before the threshold', () => {
  const guard = createLoginAttemptGuard({
    windowMs: 60_000,
    maxFailures: 3,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
  })

  assert.deepEqual(guard.check('User@Example.com', 0), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(guard.recordFailure('User@Example.com', 1_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(guard.recordFailure('user@example.com', 2_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(guard.check('user@example.com', 2_500), { allowed: true, retryAfterMs: 0 })
})

test('login attempt guard locks after the configured threshold and escalates later lockouts', () => {
  const guard = createLoginAttemptGuard({
    windowMs: 60_000,
    maxFailures: 3,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
  })

  guard.recordFailure('user@example.com', 1_000)
  guard.recordFailure('user@example.com', 2_000)
  assert.deepEqual(guard.recordFailure('user@example.com', 3_000), {
    allowed: false,
    retryAfterMs: 10_000,
  })
  assert.deepEqual(guard.check('user@example.com', 5_000), {
    allowed: false,
    retryAfterMs: 8_000,
  })

  guard.recordFailure('user@example.com', 14_000)
  guard.recordFailure('user@example.com', 15_000)
  assert.deepEqual(guard.recordFailure('user@example.com', 16_000), {
    allowed: false,
    retryAfterMs: 20_000,
  })
})

test('login attempt guard resets state after a successful sign-in', () => {
  const guard = createLoginAttemptGuard({
    windowMs: 60_000,
    maxFailures: 2,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
  })

  guard.recordFailure('user@example.com', 1_000)
  guard.reset('user@example.com')

  assert.deepEqual(guard.check('user@example.com', 2_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(guard.recordFailure('user@example.com', 3_000), { allowed: true, retryAfterMs: 0 })
})

test('login attempt guard forgets failures outside the sliding window', () => {
  const guard = createLoginAttemptGuard({
    windowMs: 5_000,
    maxFailures: 2,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
  })

  guard.recordFailure('user@example.com', 1_000)
  assert.deepEqual(guard.recordFailure('user@example.com', 7_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(guard.check('user@example.com', 7_100), { allowed: true, retryAfterMs: 0 })
})
