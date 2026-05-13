import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasRole,
  isSameInstance,
  requireActiveUser,
  requireInstanceAdmin,
  requireInstanceWriteAccess,
  requireSameInstance,
} from './guards.ts'

const activeAdmin = {
  instanceId: 'instance-1',
  role: 'instance_admin',
  roles: ['instance_admin'],
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

test('requireSameInstance accepts either instance ids or instance-scoped resources', () => {
  assert.doesNotThrow(() => requireSameInstance(activeAdmin, 'instance-1'))
  assert.doesNotThrow(() => requireSameInstance(activeAdmin, { instanceId: 'instance-1' }))
  assert.equal(isSameInstance(activeAdmin, { instanceId: 'instance-2' }), false)
})

test('requireSameInstance rejects cross-instance access', () => {
  assert.throws(
    () => requireSameInstance(activeAdmin, 'instance-2'),
    /forbidden: instance mismatch/,
  )
})

test('requireInstanceAdmin rejects non-admin roles', () => {
  assert.throws(
    () => requireInstanceAdmin({ ...activeAdmin, role: 'engineer', roles: ['engineer'] }, 'instance-1'),
    /forbidden: admin role required/,
  )
})

test('requireInstanceWriteAccess rejects read-only users', () => {
  assert.throws(
    () => requireInstanceWriteAccess({ ...activeAdmin, role: 'read_only', roles: ['read_only'] }, 'instance-1'),
    /forbidden: write role required/,
  )
})

test('hasRole handles single and multiple role checks', () => {
  assert.equal(hasRole(activeAdmin, 'instance_admin'), true)
  assert.equal(hasRole(activeAdmin, ['super_admin', 'engineer']), false)
  assert.equal(hasRole({ ...activeAdmin, role: 'engineer', roles: ['engineer', 'read_only'] }, 'read_only'), true)
  assert.equal(
    hasRole({ ...activeAdmin, role: 'engineer', roles: ['engineer', 'read_only'] }, ['super_admin', 'instance_admin']),
    false,
  )
})
