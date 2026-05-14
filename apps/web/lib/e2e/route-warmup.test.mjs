import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasFocusedE2eSpecArg,
  resolveRouteWarmupMode,
  shouldWarmRoutes,
} from './route-warmup.mjs'

test('focused e2e spec arguments skip route warmup by default', () => {
  assert.equal(hasFocusedE2eSpecArg(['tests/e2e/hosts/host-calendar.spec.ts']), true)
  assert.equal(hasFocusedE2eSpecArg(['--headed', 'tests/e2e/hosts/host-calendar.spec.ts']), true)
  assert.equal(resolveRouteWarmupMode(['tests/e2e/hosts/host-calendar.spec.ts'], {}), 'skip')
})

test('non-file Playwright option values are not treated as focused specs', () => {
  assert.equal(hasFocusedE2eSpecArg(['--grep', 'host calendar', '--project', 'chromium']), false)
  assert.equal(resolveRouteWarmupMode(['--grep', 'host calendar'], {}), 'all')
})

test('E2E_ROUTE_WARMUP overrides focused spec detection', () => {
  assert.equal(
    resolveRouteWarmupMode(['tests/e2e/hosts/host-calendar.spec.ts'], { E2E_ROUTE_WARMUP: 'all' }),
    'all',
  )
  assert.equal(shouldWarmRoutes({ E2E_ROUTE_WARMUP: '0' }), false)
})
