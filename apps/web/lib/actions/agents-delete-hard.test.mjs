import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentsSource = readFileSync(path.join(here, 'agents.ts'), 'utf8')

function actionSegment(action) {
  const start = agentsSource.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in agents.ts`)
  const next = agentsSource.indexOf('\nexport async function ', start + 1)
  return agentsSource.slice(start, next === -1 ? undefined : next)
}

test('deleteHost performs a hard delete and clears agent dependants before deleting the agent', () => {
  const segment = actionSegment('deleteHost')

  assert.match(
    segment,
    /\.delete\(hosts\)[\s\S]*\.where\(and\(eq\(hosts\.id, hostId\), eq\(hosts\.organisationId, orgId\)\)\)/,
    'deleteHost must physically delete the host row',
  )
  assert.doesNotMatch(
    segment,
    /\.update\(hosts\)[\s\S]*deletedAt/,
    'deleteHost must not soft-delete hosts',
  )

  const pendingDelete = segment.indexOf('.delete(pendingCertSignings)')
  const agentDelete = segment.indexOf('.delete(agents)')
  assert.notEqual(pendingDelete, -1, 'deleteHost must delete pending CSR rows for the agent')
  assert.notEqual(agentDelete, -1, 'deleteHost must delete the agent row')
  assert.ok(
    pendingDelete < agentDelete,
    'pending CSR rows must be deleted before the agent row to avoid FK rollback',
  )
})
