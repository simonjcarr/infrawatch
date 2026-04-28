import test from 'node:test'
import assert from 'node:assert/strict'

import { assertOrgAccess, assertOrgAdminAccess } from './action-auth-core.ts'

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

test('assertOrgAdminAccess rejects non-admin roles in the same organisation', () => {
  assert.throws(
    () => assertOrgAdminAccess({
      organisationId: 'org-1',
      isActive: true,
      deletedAt: null,
      role: 'engineer',
    }, 'org-1'),
    /forbidden: admin role required/,
  )
})

test('assertOrgAdminAccess allows org admins in their own organisation', () => {
  assert.doesNotThrow(
    () => assertOrgAdminAccess({
      organisationId: 'org-1',
      isActive: true,
      deletedAt: null,
      role: 'org_admin',
    }, 'org-1'),
  )
})
