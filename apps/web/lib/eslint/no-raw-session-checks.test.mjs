import test from 'node:test'
import assert from 'node:assert/strict'
import { Linter } from 'eslint'

import rule from './no-raw-session-checks.mjs'

function lint(code) {
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(
    code,
    [
      {
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
        plugins: {
          local: {
            rules: {
              'no-raw-session-checks': rule,
            },
          },
        },
        rules: {
          'local/no-raw-session-checks': 'error',
        },
      },
    ],
    'test.js',
  )
}

test('no-raw-session-checks allows helper-based checks', () => {
  assert.deepEqual(
    lint(`
      async function run() {
        const session = await requireOrgAccess(orgId)
        if (!hasRole(session.user, ADMIN_ROLES)) return { error: 'forbidden' }
        if (!isSameOrg(session.user, note)) return []
      }
    `),
    [],
  )
})

test('no-raw-session-checks flags direct organisation and role comparisons', () => {
  const messages = lint(`
    async function run() {
      if (session.user.organisationId !== orgId) return { error: 'Organisation mismatch' }
      if (session.user.role === 'read_only') return { error: 'Insufficient permissions' }
      if (!ADMIN_ROLES.includes(session.user.role)) return { error: 'forbidden' }
    }
  `)

  assert.equal(messages.length, 3)
  assert(messages.every((message) => message.messageId === 'useGuard'))
})
