import test from 'node:test'
import assert from 'node:assert/strict'

import { createInMemoryThrottleStore } from '../throttle-store.ts'
import {
  createEmailVerificationResendGuard,
  createEmailVerificationResendPolicy,
} from './email-verification-rate-limit.ts'

test('email verification resend guard limits requests per normalized email', async () => {
  const guard = createEmailVerificationResendGuard(60_000, 3, createInMemoryThrottleStore())

  assert.equal(await guard.check('User@Example.com'), true)
  assert.equal(await guard.check(' user@example.com '), true)
  assert.equal(await guard.check('USER@example.com'), true)
  assert.equal(await guard.check('user@example.com'), false)
})

test('email verification resend guard tracks different emails separately', async () => {
  const guard = createEmailVerificationResendGuard(60_000, 1, createInMemoryThrottleStore())

  assert.equal(await guard.check('first@example.com'), true)
  assert.equal(await guard.check('first@example.com'), false)
  assert.equal(await guard.check('second@example.com'), true)
})

test('email verification resend policy limits burst requests per source IP', async () => {
  const policy = createEmailVerificationResendPolicy({
    windowMs: 60_000,
    maxRequestsPerEmail: 3,
    maxRequestsPerIp: 2,
    store: createInMemoryThrottleStore(),
  })

  assert.equal(await policy.check({ email: 'first@example.com', ip: '203.0.113.10' }), true)
  assert.equal(await policy.check({ email: 'second@example.com', ip: '203.0.113.10' }), true)
  assert.equal(await policy.check({ email: 'third@example.com', ip: '203.0.113.10' }), false)
  assert.equal(await policy.check({ email: 'third@example.com', ip: '203.0.113.11' }), true)
})

test('email verification resend policy allows requests after the window expires', async () => {
  const policy = createEmailVerificationResendPolicy({
    windowMs: 60_000,
    maxRequestsPerEmail: 1,
    maxRequestsPerIp: 1,
    store: createInMemoryThrottleStore(),
  })

  assert.equal(await policy.check({ email: 'user@example.com', ip: '203.0.113.10' }, 1_000), true)
  assert.equal(await policy.check({ email: 'user@example.com', ip: '203.0.113.10' }, 2_000), false)
  assert.equal(await policy.check({ email: 'user@example.com', ip: '203.0.113.10' }, 62_000), true)
})
