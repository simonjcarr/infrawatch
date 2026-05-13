import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, 'host-settings.ts'), 'utf8')

function getActionSegment(action) {
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in host-settings.ts`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('host Docker retention reads inherited and effective retention values', () => {
  const segment = getActionSegment('getHostDockerRetentionSettings')

  assert.match(segment, /parseHostMetadata\(host\?\.metadata\)/)
  assert.match(segment, /instance\?\.dockerMetricRetentionDays \?\? 30/)
  assert.match(segment, /retentionDaysOverride \?\? globalRetentionDays/)
})

test('host Docker retention override requires write access and supports clearing', () => {
  const segment = getActionSegment('updateHostDockerRetentionOverride')

  assert.match(segment, /await requireInstanceWriteAccess\(currentScope\)/)
  assert.match(source, /days: z\.number\(\)\.int\(\)\.min\(1\)\.max\(365\)\.nullable\(\)/)
  assert.match(segment, /retentionDaysOverride: parsed\.data\.days/)
})
