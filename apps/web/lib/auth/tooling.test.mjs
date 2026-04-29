import test from 'node:test'
import assert from 'node:assert/strict'

import { canAccessTooling, requireToolingAccess } from './tooling.ts'

const baseUser = {
  organisationId: 'org-1',
  isActive: true,
  deletedAt: null,
}

test('canAccessTooling allows engineer and admin roles', () => {
  assert.equal(canAccessTooling({ ...baseUser, role: 'engineer', roles: ['engineer'] }), true)
  assert.equal(canAccessTooling({ ...baseUser, role: 'org_admin', roles: ['org_admin'] }), true)
  assert.equal(canAccessTooling({ ...baseUser, role: 'super_admin', roles: ['super_admin'] }), true)
  assert.equal(canAccessTooling({ ...baseUser, role: 'engineer', roles: ['read_only', 'engineer'] }), true)
})

test('requireToolingAccess rejects read-only and pending roles', () => {
  assert.equal(canAccessTooling({ ...baseUser, role: 'read_only', roles: ['read_only'] }), false)
  assert.equal(canAccessTooling({ ...baseUser, role: 'pending', roles: [] }), false)
  assert.throws(
    () => requireToolingAccess({ ...baseUser, role: 'read_only', roles: ['read_only'] }),
    /forbidden: tooling role required/,
  )
})
