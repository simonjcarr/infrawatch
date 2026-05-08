import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getPatchStatusChartColour,
  getPatchStatusChartValue,
} from './history-chart.ts'

test('patch status chart height follows available update count', () => {
  assert.equal(getPatchStatusChartValue('{"patch_age_days":12,"updates_count":0}'), 0)
  assert.equal(getPatchStatusChartValue('{"patch_age_days":12,"updates_count":7}'), 7)
  assert.equal(getPatchStatusChartValue('not json'), 0)
})

test('patch status chart colour follows patch age policy threshold', () => {
  assert.equal(getPatchStatusChartColour('{"patch_age_days":24,"updates_count":4}', 30), '#22c55e')
  assert.equal(getPatchStatusChartColour('{"patch_age_days":25,"updates_count":4}', 30), '#f59e0b')
  assert.equal(getPatchStatusChartColour('{"patch_age_days":31,"updates_count":4}', 30), '#ef4444')
})
