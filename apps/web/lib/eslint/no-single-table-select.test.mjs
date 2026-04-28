import test from 'node:test'
import assert from 'node:assert/strict'
import { Linter } from 'eslint'

import rule from './no-single-table-select.mjs'

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
              'no-single-table-select': rule,
            },
          },
        },
        rules: {
          'local/no-single-table-select': 'error',
        },
      },
    ],
    'test.js',
  )
}

test('no-single-table-select allows aggregates and joins', () => {
  assert.deepEqual(
    lint(`
      const rows = await db.select({ total: count() }).from(tags).where(eq(tags.organisationId, orgId))
    `),
    [],
  )

  assert.deepEqual(
    lint(`
      const rows = await db
        .select({ tagId: tags.id, hostId: hosts.id })
        .from(tags)
        .innerJoin(hosts, eq(hosts.organisationId, tags.organisationId))
    `),
    [],
  )
})

test('no-single-table-select flags simple single-table reads on db and tx', () => {
  const dbMessages = lint(`
    const rows = await db
      .select()
      .from(tags)
      .where(eq(tags.organisationId, orgId))
      .orderBy(desc(tags.usageCount))
  `)
  assert.equal(dbMessages.length, 1)
  assert.equal(dbMessages[0]?.messageId, 'preferQueryApi')

  const txMessages = lint(`
    const rows = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.organisationId, orgId))
  `)
  assert.equal(txMessages.length, 1)
  assert.equal(txMessages[0]?.messageId, 'preferQueryApi')
})
