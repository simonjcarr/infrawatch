import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getDirectSignupProvisioning,
  isInviteSignupCallback,
} from './signup-provisioning.ts'

test('direct signup provisioning assigns the first user as super admin', () => {
  assert.deepEqual(
    getDirectSignupProvisioning({ defaultInstanceId: 'instance-1', activeUserCount: 0 }),
    {
      instanceId: 'instance-1',
      role: 'super_admin',
      roles: ['super_admin'],
    },
  )
})

test('direct signup provisioning assigns later users to the default instance as engineers', () => {
  assert.deepEqual(
    getDirectSignupProvisioning({ defaultInstanceId: 'instance-1', activeUserCount: 2 }),
    {
      instanceId: 'instance-1',
      role: 'engineer',
      roles: ['engineer'],
    },
  )
})

test('invite callback detection only matches invite acceptance callbacks with tokens', () => {
  assert.equal(isInviteSignupCallback('/accept-invite?token=abc123'), true)
  assert.equal(isInviteSignupCallback('https://ct-ops.example.com/accept-invite?token=abc123'), true)
  assert.equal(isInviteSignupCallback('/accept-invite'), false)
  assert.equal(isInviteSignupCallback('/dashboard'), false)
  assert.equal(isInviteSignupCallback(undefined), false)
})
