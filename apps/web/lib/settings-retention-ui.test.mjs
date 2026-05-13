import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/settings/settings-client.tsx'),
  'utf8',
)

test('settings retention UI exposes separate host and Docker retention controls', () => {
  assert.match(source, /updateDockerMetricRetention/, 'Docker retention action must be imported')
  assert.match(source, /settings-retention-select/, 'host metric retention select should remain available')
  assert.match(source, /settings-docker-retention-select/, 'Docker metric retention select must be available')
  assert.match(source, /settings-docker-retention-save/, 'Docker metric retention save button must be available')
  assert.match(source, /org\.dockerMetricRetentionDays \?\? 30/, 'Docker retention should default to 30 days')
})
