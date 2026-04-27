import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEmailVerificationResendGuard,
  createEmailVerificationResendPolicy,
} from './email-verification-rate-limit.ts'

test('email verification resend guard limits requests per normalized email', () => {
  const guard = createEmailVerificationResendGuard(60_000, 3)

  assert.equal(guard.check('User@Example.com'), true)
  assert.equal(guard.check(' user@example.com '), true)
  assert.equal(guard.check('USER@example.com'), true)
  assert.equal(guard.check('user@example.com'), false)
})

test('email verification resend guard tracks different emails separately', () => {
  const guard = createEmailVerificationResendGuard(60_000, 1)

  assert.equal(guard.check('first@example.com'), true)
  assert.equal(guard.check('first@example.com'), false)
  assert.equal(guard.check('second@example.com'), true)
})

test('email verification resend policy limits burst requests per source IP', () => {
  const policy = createEmailVerificationResendPolicy({
    windowMs: 60_000,
    maxRequestsPerEmail: 3,
    maxRequestsPerIp: 2,
  })

  assert.equal(policy.check({ email: 'first@example.com', ip: '203.0.113.10' }), true)
  assert.equal(policy.check({ email: 'second@example.com', ip: '203.0.113.10' }), true)
  assert.equal(policy.check({ email: 'third@example.com', ip: '203.0.113.10' }), false)
  assert.equal(policy.check({ email: 'third@example.com', ip: '203.0.113.11' }), true)
})

test('email verification resend policy allows requests after the window expires', () => {
  const policy = createEmailVerificationResendPolicy({
    windowMs: 60_000,
    maxRequestsPerEmail: 1,
    maxRequestsPerIp: 1,
  })

  assert.equal(policy.check({ email: 'user@example.com', ip: '203.0.113.10' }, 1_000), true)
  assert.equal(policy.check({ email: 'user@example.com', ip: '203.0.113.10' }, 2_000), false)
  assert.equal(policy.check({ email: 'user@example.com', ip: '203.0.113.10' }, 62_000), true)
})
