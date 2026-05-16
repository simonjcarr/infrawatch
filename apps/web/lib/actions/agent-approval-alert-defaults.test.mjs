import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentsSource = readFileSync(path.join(here, 'agents-core.ts'), 'utf8')
const alertsSource = readFileSync(path.join(here, 'alerts.ts'), 'utf8')

test('agent approval does not automatically apply global alert defaults', () => {
  assert.doesNotMatch(
    agentsSource,
    /applyGlobalDefaultsToHost/,
    'new hosts should only receive global alert defaults when an admin explicitly applies them',
  )
})

test('global alert defaults remain explicitly applicable to hosts', () => {
  assert.match(
    alertsSource,
    /export async function replaceHostMetricAlertsWithGlobalDefaults/,
    'host-level apply action should remain available',
  )
  assert.match(
    alertsSource,
    /export async function replaceAllHostMetricAlertsWithGlobalDefaults/,
    'all-host apply action should remain available',
  )
})
