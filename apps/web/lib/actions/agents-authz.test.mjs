import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentsSource = readFileSync(path.join(here, 'agents-core.ts'), 'utf8')

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
    const start = agentsSource.lastIndexOf(`export async function ${action}`)
    assert.notEqual(start, -1, `expected ${action} to exist in agents-core.ts`)
    const next = agentsSource.indexOf('\nexport async function ', start + 1)
    const segment = agentsSource.slice(start, next === -1 ? undefined : next)

    assert.match(
      segment,
      /requireInstance(?:Admin|Tooling)Access\(instanceId\)/,
      `${action} must require an instance-scoped privileged guard before mutating fleet state`,
    )
  }
})

test('listing enrolment tokens requires privileged access because plaintext tokens are returned', () => {
  const start = agentsSource.lastIndexOf('export async function listEnrolmentTokens')
  assert.notEqual(start, -1, 'expected listEnrolmentTokens to exist in agents-core.ts')
  const next = agentsSource.indexOf('\nexport async function ', start + 1)
  const segment = agentsSource.slice(start, next === -1 ? undefined : next)

  assert.match(
    segment,
    /requireInstance(?:Admin|Tooling)Access\(instanceId\)/,
    'listEnrolmentTokens must require privileged access before returning enrolment token secrets',
  )
})
