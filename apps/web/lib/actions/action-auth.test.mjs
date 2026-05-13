import test from 'node:test'
import assert from 'node:assert/strict'

import { assertInstanceAccess, assertInstanceAdminAccess, assertInstanceWriteAccess } from './action-auth-core.ts'

test('assertInstanceAccess rejects inactive users', () => {
  assert.throws(
    () => assertInstanceAccess({ instanceId: 'instance-1', isActive: false, deletedAt: null }, 'instance-1'),
    /forbidden: inactive user/,
  )
})

test('assertInstanceAccess rejects deleted users', () => {
  assert.throws(
    () => assertInstanceAccess({ instanceId: 'instance-1', isActive: true, deletedAt: new Date() }, 'instance-1'),
    /forbidden: inactive user/,
  )
})

test('assertInstanceAccess rejects cross-instance access', () => {
  assert.throws(
    () => assertInstanceAccess({ instanceId: 'instance-1', isActive: true, deletedAt: null }, 'instance-2'),
    /forbidden: instance mismatch/,
  )
})

test('assertInstanceAccess allows active users in their own instance', () => {
  assert.doesNotThrow(
    () => assertInstanceAccess({ instanceId: 'instance-1', isActive: true, deletedAt: null }, 'instance-1'),
  )
})

test('assertInstanceWriteAccess rejects read-only users in their own instance', () => {
  assert.throws(
    () => assertInstanceWriteAccess({
      instanceId: 'instance-1',
      isActive: true,
      deletedAt: null,
      role: 'read_only',
    }, 'instance-1'),
    /forbidden: write role required/,
  )
})

test('assertInstanceWriteAccess allows engineers in their own instance', () => {
  assert.doesNotThrow(
    () => assertInstanceWriteAccess({
      instanceId: 'instance-1',
      isActive: true,
      deletedAt: null,
      role: 'engineer',
    }, 'instance-1'),
  )
})

test('assertInstanceAdminAccess rejects non-admin roles in the same instance', () => {
  assert.throws(
    () => assertInstanceAdminAccess({
      instanceId: 'instance-1',
      isActive: true,
      deletedAt: null,
      role: 'engineer',
    }, 'instance-1'),
    /forbidden: admin role required/,
  )
})

test('assertInstanceAdminAccess allows instance admins in their own instance', () => {
  assert.doesNotThrow(
    () => assertInstanceAdminAccess({
      instanceId: 'instance-1',
      isActive: true,
      deletedAt: null,
      role: 'instance_admin',
    }, 'instance-1'),
  )
})
