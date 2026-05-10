import test from 'node:test'
import assert from 'node:assert/strict'

import { assertInstanceAccess, assertInstanceAdminAccess, assertInstanceWriteAccess } from './action-auth-core.ts'

test('assertInstanceAccess rejects inactive users', () => {
  assert.throws(
    () => assertInstanceAccess({ instanceId: 'org-1', isActive: false, deletedAt: null }, 'org-1'),
    /forbidden: inactive user/,
  )
})

test('assertInstanceAccess rejects deleted users', () => {
  assert.throws(
    () => assertInstanceAccess({ instanceId: 'org-1', isActive: true, deletedAt: new Date() }, 'org-1'),
    /forbidden: inactive user/,
  )
})

test('assertInstanceAccess rejects cross-org access', () => {
  assert.throws(
    () => assertInstanceAccess({ instanceId: 'org-1', isActive: true, deletedAt: null }, 'org-2'),
    /forbidden: instance mismatch/,
  )
})

test('assertInstanceAccess allows active users in their own instance', () => {
  assert.doesNotThrow(
    () => assertInstanceAccess({ instanceId: 'org-1', isActive: true, deletedAt: null }, 'org-1'),
  )
})

test('assertInstanceWriteAccess rejects read-only users in their own instance', () => {
  assert.throws(
    () => assertInstanceWriteAccess({
      instanceId: 'org-1',
      isActive: true,
      deletedAt: null,
      role: 'read_only',
    }, 'org-1'),
    /forbidden: write role required/,
  )
})

test('assertInstanceWriteAccess allows engineers in their own instance', () => {
  assert.doesNotThrow(
    () => assertInstanceWriteAccess({
      instanceId: 'org-1',
      isActive: true,
      deletedAt: null,
      role: 'engineer',
    }, 'org-1'),
  )
})

test('assertInstanceAdminAccess rejects non-admin roles in the same instance', () => {
  assert.throws(
    () => assertInstanceAdminAccess({
      instanceId: 'org-1',
      isActive: true,
      deletedAt: null,
      role: 'engineer',
    }, 'org-1'),
    /forbidden: admin role required/,
  )
})

test('assertInstanceAdminAccess allows org admins in their own instance', () => {
  assert.doesNotThrow(
    () => assertInstanceAdminAccess({
      instanceId: 'org-1',
      isActive: true,
      deletedAt: null,
      role: 'org_admin',
    }, 'org-1'),
  )
})
