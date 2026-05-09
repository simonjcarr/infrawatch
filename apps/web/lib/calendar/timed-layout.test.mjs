import assert from 'node:assert/strict'
import test from 'node:test'

import { getTimedEventLayouts } from './timed-layout.ts'

test('places same-time timed events side by side with equal width', () => {
  const layouts = getTimedEventLayouts([
    {
      id: 'first',
      startsAt: '2026-05-08T10:00:00.000Z',
      endsAt: '2026-05-08T11:00:00.000Z',
    },
    {
      id: 'second',
      startsAt: '2026-05-08T10:00:00.000Z',
      endsAt: '2026-05-08T11:00:00.000Z',
    },
  ])

  assert.deepEqual(layouts.first, { column: 0, columns: 2, leftPercent: 0, widthPercent: 50 })
  assert.deepEqual(layouts.second, { column: 1, columns: 2, leftPercent: 50, widthPercent: 50 })
})

test('uses the same column count for a connected overlap group', () => {
  const layouts = getTimedEventLayouts([
    {
      id: 'early',
      startsAt: '2026-05-08T09:00:00.000Z',
      endsAt: '2026-05-08T10:00:00.000Z',
    },
    {
      id: 'middle',
      startsAt: '2026-05-08T09:30:00.000Z',
      endsAt: '2026-05-08T10:30:00.000Z',
    },
    {
      id: 'late',
      startsAt: '2026-05-08T10:00:00.000Z',
      endsAt: '2026-05-08T11:00:00.000Z',
    },
    {
      id: 'separate',
      startsAt: '2026-05-08T12:00:00.000Z',
      endsAt: '2026-05-08T13:00:00.000Z',
    },
  ])

  assert.equal(layouts.early.columns, 2)
  assert.equal(layouts.middle.columns, 2)
  assert.equal(layouts.late.columns, 2)
  assert.deepEqual(layouts.separate, { column: 0, columns: 1, leftPercent: 0, widthPercent: 100 })
})
