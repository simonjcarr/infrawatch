import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_MANAGER_COMMAND_ITEM,
  PASSWORD_MANAGER_NAV_ITEM,
} from './navigation.ts'

test('Password Manager sidebar navigation targets the hosted route', () => {
  assert.equal(PASSWORD_MANAGER_NAV_ITEM.title, 'Password Manager')
  assert.equal(PASSWORD_MANAGER_NAV_ITEM.href, '/password-manager')
  assert.equal(PASSWORD_MANAGER_NAV_ITEM.testId, 'sidebar-password-manager')
})

test('Password Manager command palette item exposes route and search keywords', () => {
  assert.equal(PASSWORD_MANAGER_COMMAND_ITEM.id, 'nav-password-manager')
  assert.equal(PASSWORD_MANAGER_COMMAND_ITEM.label, 'Password Manager')
  assert.equal(PASSWORD_MANAGER_COMMAND_ITEM.href, '/password-manager')
  assert.deepEqual(
    PASSWORD_MANAGER_COMMAND_ITEM.keywords,
    ['vault', 'secrets', 'credentials', 'tooling'],
  )
})
