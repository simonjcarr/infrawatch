import test from 'node:test'
import assert from 'node:assert/strict'

import { createInMemoryThrottleStore } from '../throttle-store.ts'
import { createLoginAttemptGuard } from './login-attempts.ts'

function createGuard() {
  return createLoginAttemptGuard({
    scope: 'test:login-attempts',
    windowMs: 60_000,
    maxFailures: 3,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
    store: createInMemoryThrottleStore(),
  })
}

test('login attempt guard allows attempts before the threshold', async () => {
  const guard = createGuard()

  assert.deepEqual(await guard.check('User@Example.com', 0), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(await guard.recordFailure('User@Example.com', 1_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(await guard.recordFailure('user@example.com', 2_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(await guard.check('user@example.com', 2_500), { allowed: true, retryAfterMs: 0 })
})

test('login attempt guard locks after the configured threshold and escalates later lockouts', async () => {
  const guard = createGuard()

  await guard.recordFailure('user@example.com', 1_000)
  await guard.recordFailure('user@example.com', 2_000)
  assert.deepEqual(await guard.recordFailure('user@example.com', 3_000), {
    allowed: false,
    retryAfterMs: 10_000,
  })
  assert.deepEqual(await guard.check('user@example.com', 5_000), {
    allowed: false,
    retryAfterMs: 8_000,
  })

  await guard.recordFailure('user@example.com', 14_000)
  await guard.recordFailure('user@example.com', 15_000)
  assert.deepEqual(await guard.recordFailure('user@example.com', 16_000), {
    allowed: false,
    retryAfterMs: 20_000,
  })
})

test('login attempt guard resets state after a successful sign-in', async () => {
  const guard = createLoginAttemptGuard({
    scope: 'test:login-attempts-reset',
    windowMs: 60_000,
    maxFailures: 2,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
    store: createInMemoryThrottleStore(),
  })

  await guard.recordFailure('user@example.com', 1_000)
  await guard.reset('user@example.com')

  assert.deepEqual(await guard.check('user@example.com', 2_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(await guard.recordFailure('user@example.com', 3_000), { allowed: true, retryAfterMs: 0 })
})

test('login attempt guard forgets failures outside the sliding window', async () => {
  const guard = createLoginAttemptGuard({
    scope: 'test:login-attempts-window',
    windowMs: 5_000,
    maxFailures: 2,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
    store: createInMemoryThrottleStore(),
  })

  await guard.recordFailure('user@example.com', 1_000)
  assert.deepEqual(await guard.recordFailure('user@example.com', 7_000), { allowed: true, retryAfterMs: 0 })
  assert.deepEqual(await guard.check('user@example.com', 7_100), { allowed: true, retryAfterMs: 0 })
})

test('login attempt guard shares failures across instances when backed by the same store', async () => {
  const store = createInMemoryThrottleStore()
  const guardA = createLoginAttemptGuard({
    scope: 'test:login-attempts-shared',
    windowMs: 60_000,
    maxFailures: 3,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
    store,
  })
  const guardB = createLoginAttemptGuard({
    scope: 'test:login-attempts-shared',
    windowMs: 60_000,
    maxFailures: 3,
    baseLockoutMs: 10_000,
    maxLockoutMs: 60_000,
    store,
  })

  await guardA.recordFailure('user@example.com', 1_000)
  await guardB.recordFailure('user@example.com', 2_000)
  assert.deepEqual(await guardA.recordFailure('user@example.com', 3_000), {
    allowed: false,
    retryAfterMs: 10_000,
  })
  assert.deepEqual(await guardB.check('user@example.com', 4_000), {
    allowed: false,
    retryAfterMs: 9_000,
  })
})
