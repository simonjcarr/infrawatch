import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PASSWORD_GENERATOR_COMMAND_ITEM,
  PASSWORD_GENERATOR_NAV_ITEM,
} from './navigation.ts'

test('Password Generator sidebar navigation targets the tooling route', () => {
  assert.equal(PASSWORD_GENERATOR_NAV_ITEM.title, 'Password Generator')
  assert.equal(PASSWORD_GENERATOR_NAV_ITEM.href, '/password-generator')
  assert.equal(PASSWORD_GENERATOR_NAV_ITEM.testId, 'sidebar-password-generator')
})

test('Password Generator command palette item exposes route and search keywords', () => {
  assert.equal(PASSWORD_GENERATOR_COMMAND_ITEM.id, 'nav-password-generator')
  assert.equal(PASSWORD_GENERATOR_COMMAND_ITEM.label, 'Password Generator')
  assert.equal(PASSWORD_GENERATOR_COMMAND_ITEM.href, '/password-generator')
  assert.deepEqual(
    PASSWORD_GENERATOR_COMMAND_ITEM.keywords,
    ['password', 'generator', 'secrets', 'credentials', 'tooling'],
  )
})
