import test from 'node:test'
import assert from 'node:assert/strict'

import { assertOrgAccess } from './action-auth-core.ts'

test('assertOrgAccess rejects inactive users', () => {
  assert.throws(
    () => assertOrgAccess({ organisationId: 'org-1', isActive: false, deletedAt: null }, 'org-1'),
    /forbidden: inactive user/,
  )
})

test('assertOrgAccess rejects deleted users', () => {
  assert.throws(
    () => assertOrgAccess({ organisationId: 'org-1', isActive: true, deletedAt: new Date() }, 'org-1'),
    /forbidden: inactive user/,
  )
})

test('assertOrgAccess rejects cross-org access', () => {
  assert.throws(
    () => assertOrgAccess({ organisationId: 'org-1', isActive: true, deletedAt: null }, 'org-2'),
    /forbidden: organisation mismatch/,
  )
})

test('assertOrgAccess allows active users in their own organisation', () => {
  assert.doesNotThrow(
    () => assertOrgAccess({ organisationId: 'org-1', isActive: true, deletedAt: null }, 'org-1'),
  )
})
