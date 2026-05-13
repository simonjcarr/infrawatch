import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, 'settings.ts'), 'utf8')

function getActionSegment(action) {
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in settings.ts`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('updateDockerMetricRetention requires admin access and stores the Docker-specific column', () => {
  const segment = getActionSegment('updateDockerMetricRetention')

  assert.match(
    segment,
    /await requireInstanceAdminAccess\(instanceId\)/,
    'Docker retention updates must require instance admin access',
  )
  assert.match(
    segment,
    /dockerMetricRetentionDays: parsed\.data\.days/,
    'Docker retention updates must not reuse host metric retention',
  )
})

test('updateDockerMetricRetention validates the Docker retention contract bounds', () => {
  assert.match(
    source,
    /dockerMetricRetentionSchema = z\.object\(\{\s*days: z\.number\(\)\.int\(\)\.min\(1\)\.max\(365\),?\s*\}\)/s,
    'Docker retention must be bounded to whole days in the 1..365 range',
  )
})
