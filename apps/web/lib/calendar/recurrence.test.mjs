import assert from 'node:assert/strict'
import test from 'node:test'

import {
  expandCalendarSeries,
  validateCalendarRange,
} from './recurrence.ts'

const baseSeries = {
  id: 'series-1',
  title: 'Weekly patch planning',
  startsAt: new Date('2026-05-04T09:00:00.000Z'),
  endsAt: new Date('2026-05-04T10:00:00.000Z'),
  allDay: false,
  timezone: 'UTC',
  recurrenceRule: {
    freq: 'weekly',
    interval: 1,
    byWeekday: ['mo'],
    count: 4,
  },
}

test('expands a bounded weekly calendar series into range instances', () => {
  const instances = expandCalendarSeries({
    series: baseSeries,
    rangeStart: new Date('2026-05-01T00:00:00.000Z'),
    rangeEnd: new Date('2026-06-01T00:00:00.000Z'),
    exceptions: [],
  })

  assert.deepEqual(
    instances.map((instance) => instance.startsAt.toISOString()),
    [
      '2026-05-04T09:00:00.000Z',
      '2026-05-11T09:00:00.000Z',
      '2026-05-18T09:00:00.000Z',
      '2026-05-25T09:00:00.000Z',
    ],
  )
})

test('recurrence exceptions replace or cancel individual occurrences', () => {
  const instances = expandCalendarSeries({
    series: baseSeries,
    rangeStart: new Date('2026-05-01T00:00:00.000Z'),
    rangeEnd: new Date('2026-06-01T00:00:00.000Z'),
    exceptions: [
      {
        id: 'exception-1',
        seriesId: 'series-1',
        exceptionType: 'modified',
        recurrenceInstanceStartAt: new Date('2026-05-11T09:00:00.000Z'),
        startsAt: new Date('2026-05-12T11:00:00.000Z'),
        endsAt: new Date('2026-05-12T12:30:00.000Z'),
      },
      {
        id: 'exception-2',
        seriesId: 'series-1',
        exceptionType: 'cancelled',
        recurrenceInstanceStartAt: new Date('2026-05-18T09:00:00.000Z'),
        startsAt: new Date('2026-05-18T09:00:00.000Z'),
        endsAt: new Date('2026-05-18T10:00:00.000Z'),
      },
    ],
  })

  assert.deepEqual(
    instances.map((instance) => ({
      id: instance.id,
      startsAt: instance.startsAt.toISOString(),
      isException: instance.isException,
    })),
    [
      { id: 'series-1:2026-05-04T09:00:00.000Z', startsAt: '2026-05-04T09:00:00.000Z', isException: false },
      { id: 'exception-1', startsAt: '2026-05-12T11:00:00.000Z', isException: true },
      { id: 'series-1:2026-05-25T09:00:00.000Z', startsAt: '2026-05-25T09:00:00.000Z', isException: false },
    ],
  )
})

test('calendar listing rejects unbounded ranges', () => {
  assert.throws(
    () => validateCalendarRange({
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2027-03-01T00:00:00.000Z'),
    }),
    /range cannot exceed/i,
  )
})
