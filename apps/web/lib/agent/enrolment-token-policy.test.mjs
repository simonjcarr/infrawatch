import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ENROLMENT_TOKEN_EXPIRY_DAYS,
  DEFAULT_ENROLMENT_TOKEN_MAX_USES,
  calculateEnrolmentTokenExpiry,
  normaliseEnrolmentTokenLimits,
} from './enrolment-token-policy.ts'

test('normaliseEnrolmentTokenLimits applies secure defaults when limits are omitted', () => {
  assert.deepEqual(normaliseEnrolmentTokenLimits({}), {
    maxUses: DEFAULT_ENROLMENT_TOKEN_MAX_USES,
    expiresInDays: DEFAULT_ENROLMENT_TOKEN_EXPIRY_DAYS,
  })
})

test('normaliseEnrolmentTokenLimits preserves explicit limits', () => {
  assert.deepEqual(normaliseEnrolmentTokenLimits({ maxUses: 25, expiresInDays: 14 }), {
    maxUses: 25,
    expiresInDays: 14,
  })
})

test('calculateEnrolmentTokenExpiry adds the requested number of days', () => {
  const now = new Date('2026-04-27T12:00:00.000Z')
  assert.equal(
    calculateEnrolmentTokenExpiry(7, now).toISOString(),
    '2026-05-04T12:00:00.000Z',
  )
})
