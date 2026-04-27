import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createVerificationEmailUrl,
  getVerificationResendClientIp,
  normalizeVerificationEmail,
  sanitizeVerificationCallbackPath,
} from './email-verification-resend.ts'

test('normalizeVerificationEmail lowercases and trims email input', () => {
  assert.equal(normalizeVerificationEmail(' User@Example.COM '), 'user@example.com')
})

test('getVerificationResendClientIp prefers the first forwarded address', () => {
  const request = new Request('https://ct-ops.example.com/api/auth/resend-verification-email', {
    headers: {
      'x-forwarded-for': '203.0.113.10, 198.51.100.7',
      'x-real-ip': '198.51.100.8',
    },
  })

  assert.equal(getVerificationResendClientIp(request), '203.0.113.10')
})

test('sanitizeVerificationCallbackPath only allows local paths', () => {
  assert.equal(sanitizeVerificationCallbackPath('/dashboard'), '/dashboard')
  assert.equal(sanitizeVerificationCallbackPath('https://evil.example.com'), '/dashboard')
  assert.equal(sanitizeVerificationCallbackPath('//evil.example.com/path'), '/dashboard')
  assert.equal(sanitizeVerificationCallbackPath('/dashboard\nSet-Cookie: bad=1'), '/dashboard')
})

test('createVerificationEmailUrl builds a local verification URL', () => {
  assert.equal(
    createVerificationEmailUrl({
      baseUrl: 'https://ct-ops.example.com/app',
      token: 'token-value',
      callbackPath: '/dashboard',
    }),
    'https://ct-ops.example.com/verify-email?token=token-value&callbackURL=%2Fdashboard',
  )
})
