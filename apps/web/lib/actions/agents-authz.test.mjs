import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentsSource = readFileSync(path.join(here, 'agents.ts'), 'utf8')

const privilegedActions = [
  'approveAgent',
  'rejectAgent',
  'createEnrolmentToken',
  'revokeEnrolmentToken',
  'deleteHost',
  'uninstallAndDeleteHost',
]

test('privileged agent and host mutations require tooling access', () => {
  for (const action of privilegedActions) {
    const start = agentsSource.indexOf(`export async function ${action}`)
    assert.notEqual(start, -1, `expected ${action} to exist in agents.ts`)
    const next = agentsSource.indexOf('\nexport async function ', start + 1)
    const segment = agentsSource.slice(start, next === -1 ? undefined : next)

    assert.match(
      segment,
      /requireOrg(?:Admin|Tooling)Access\(orgId\)/,
      `${action} must require an org-scoped privileged guard before mutating fleet state`,
    )
  }
})
