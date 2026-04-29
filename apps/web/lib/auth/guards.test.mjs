import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasRole,
  isSameOrg,
  requireActiveUser,
  requireOrgAdmin,
  requireOrgWriteAccess,
  requireSameOrg,
} from './guards.ts'

const activeAdmin = {
  organisationId: 'org-1',
  role: 'org_admin',
  roles: ['org_admin'],
  isActive: true,
  deletedAt: null,
}

test('requireActiveUser rejects inactive or deleted users', () => {
  assert.throws(
    () => requireActiveUser({ ...activeAdmin, isActive: false }),
    /forbidden: inactive user/,
  )
  assert.throws(
    () => requireActiveUser({ ...activeAdmin, deletedAt: new Date() }),
    /forbidden: inactive user/,
  )
})

test('requireSameOrg accepts either org ids or org-scoped resources', () => {
  assert.doesNotThrow(() => requireSameOrg(activeAdmin, 'org-1'))
  assert.doesNotThrow(() => requireSameOrg(activeAdmin, { organisationId: 'org-1' }))
  assert.equal(isSameOrg(activeAdmin, { organisationId: 'org-2' }), false)
})

test('requireSameOrg rejects cross-org access', () => {
  assert.throws(
    () => requireSameOrg(activeAdmin, 'org-2'),
    /forbidden: organisation mismatch/,
  )
})

test('requireOrgAdmin rejects non-admin roles', () => {
  assert.throws(
    () => requireOrgAdmin({ ...activeAdmin, role: 'engineer', roles: ['engineer'] }, 'org-1'),
    /forbidden: admin role required/,
  )
})

test('requireOrgWriteAccess rejects read-only users', () => {
  assert.throws(
    () => requireOrgWriteAccess({ ...activeAdmin, role: 'read_only', roles: ['read_only'] }, 'org-1'),
    /forbidden: write role required/,
  )
})

test('hasRole handles single and multiple role checks', () => {
  assert.equal(hasRole(activeAdmin, 'org_admin'), true)
  assert.equal(hasRole(activeAdmin, ['super_admin', 'engineer']), false)
  assert.equal(hasRole({ ...activeAdmin, role: 'engineer', roles: ['engineer', 'read_only'] }, 'read_only'), true)
  assert.equal(
    hasRole({ ...activeAdmin, role: 'engineer', roles: ['engineer', 'read_only'] }, ['super_admin', 'org_admin']),
    false,
  )
})
