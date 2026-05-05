import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertAgentCAManagementAccess } from './security-auth.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const securitySource = readFileSync(path.join(here, 'security.ts'), 'utf8')

const baseUser = {
  role: 'org_admin',
  roles: ['org_admin'],
}

test('Agent CA management rejects org admins', () => {
  assert.throws(
    () => assertAgentCAManagementAccess(baseUser),
    /forbidden: super_admin role required/,
  )
})

test('Agent CA management allows super admins', () => {
  assert.doesNotThrow(
    () => assertAgentCAManagementAccess({
      ...baseUser,
      role: 'super_admin',
      roles: ['super_admin'],
    }),
  )
})

test('uploadAgentCA requires Agent CA management access before rotating the global CA', () => {
  const start = securitySource.indexOf('export async function uploadAgentCA')
  assert.notEqual(start, -1, 'expected uploadAgentCA to exist')
  const segment = securitySource.slice(start)

  const guardIndex = segment.indexOf('await requireAgentCAManager()')
  const transactionIndex = segment.indexOf('await db.transaction')
  assert.ok(guardIndex >= 0, 'uploadAgentCA must require Agent CA management access')
  assert.ok(transactionIndex >= 0, 'uploadAgentCA should still rotate the CA in a transaction')
  assert.ok(guardIndex < transactionIndex, 'Agent CA access must be checked before CA rotation')
})
