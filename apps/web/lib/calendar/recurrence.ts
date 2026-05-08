import { createRequire } from 'node:module'
import type { Options, Weekday } from 'rrule'
import type { CalendarExceptionType, CalendarRecurrenceRule, CalendarWeekday } from '../db/schema/calendar.ts'

const MAX_CALENDAR_RANGE_DAYS = 370
const MAX_EXPANDED_INSTANCES = 1000
const DAY_MS = 24 * 60 * 60 * 1000
const require = createRequire(import.meta.url)
const { RRule } = require('rrule') as typeof import('rrule')

const WEEKDAY_MAP: Record<CalendarWeekday, Weekday> = {
  mo: RRule.MO,
  tu: RRule.TU,
  we: RRule.WE,
  th: RRule.TH,
  fr: RRule.FR,
  sa: RRule.SA,
  su: RRule.SU,
}

const FREQ_MAP: Record<CalendarRecurrenceRule['freq'], Options['freq']> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
}

export interface CalendarRangeInput {
  startsAt: Date
  endsAt: Date
}

export interface CalendarSeriesInput {
  id: string
  title: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  timezone: string
  recurrenceRule: CalendarRecurrenceRule
}

export interface CalendarSeriesExceptionInput {
  id: string
  seriesId: string | null
  exceptionType: CalendarExceptionType | null
  recurrenceInstanceStartAt: Date | null
  startsAt: Date
  endsAt: Date
}

export interface ExpandedCalendarInstance {
  id: string
  eventId: string
  seriesId: string | null
  recurrenceInstanceStartAt: Date
  startsAt: Date
  endsAt: Date
  allDay: boolean
  isException: boolean
}

export function validateCalendarRange(range: CalendarRangeInput): void {
  const startsAt = range.startsAt.getTime()
  const endsAt = range.endsAt.getTime()

  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new Error('Calendar range must have a valid start and end')
  }

  if (endsAt - startsAt > MAX_CALENDAR_RANGE_DAYS * DAY_MS) {
    throw new Error(`Calendar range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days`)
  }
}

function overlapsRange(startsAt: Date, endsAt: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return startsAt < rangeEnd && endsAt > rangeStart
}

function buildRRule(series: CalendarSeriesInput): InstanceType<typeof RRule> {
  const rule = series.recurrenceRule
  const options: Partial<Options> = {
    freq: FREQ_MAP[rule.freq],
    interval: Math.max(1, Math.trunc(rule.interval)),
    dtstart: series.startsAt,
  }

  if (rule.byWeekday && rule.byWeekday.length > 0) {
    options.byweekday = rule.byWeekday.map((weekday) => WEEKDAY_MAP[weekday])
  }
  if (rule.count != null) {
    options.count = Math.max(1, Math.trunc(rule.count))
  }
  if (rule.until) {
    const until = new Date(rule.until)
    if (Number.isFinite(until.getTime())) {
      options.until = until
    }
  }

  return new RRule(options)
}

function exceptionKey(date: Date): string {
  return date.toISOString()
}

export function expandCalendarSeries(input: {
  series: CalendarSeriesInput
  rangeStart: Date
  rangeEnd: Date
  exceptions: CalendarSeriesExceptionInput[]
  maxInstances?: number
}): ExpandedCalendarInstance[] {
  validateCalendarRange({ startsAt: input.rangeStart, endsAt: input.rangeEnd })

  const durationMs = input.series.endsAt.getTime() - input.series.startsAt.getTime()
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('Calendar series duration must be positive')
  }

  const maxInstances = input.maxInstances ?? MAX_EXPANDED_INSTANCES
  const exceptionsByOriginalStart = new Map<string, CalendarSeriesExceptionInput>()
  for (const exception of input.exceptions) {
    if (exception.seriesId !== input.series.id || !exception.recurrenceInstanceStartAt) continue
    exceptionsByOriginalStart.set(exceptionKey(exception.recurrenceInstanceStartAt), exception)
  }

  const rule = buildRRule(input.series)
  const paddedStart = new Date(input.rangeStart.getTime() - durationMs)
  const occurrenceStarts = rule.between(paddedStart, input.rangeEnd, true)
  const instances: ExpandedCalendarInstance[] = []

  for (const occurrenceStart of occurrenceStarts) {
    const originalStartKey = exceptionKey(occurrenceStart)
    const exception = exceptionsByOriginalStart.get(originalStartKey)
    if (exception?.exceptionType === 'cancelled') {
      continue
    }

    if (exception?.exceptionType === 'modified') {
      if (overlapsRange(exception.startsAt, exception.endsAt, input.rangeStart, input.rangeEnd)) {
        instances.push({
          id: exception.id,
          eventId: exception.id,
          seriesId: input.series.id,
          recurrenceInstanceStartAt: occurrenceStart,
          startsAt: exception.startsAt,
          endsAt: exception.endsAt,
          allDay: input.series.allDay,
          isException: true,
        })
      }
      continue
    }

    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
    if (!overlapsRange(occurrenceStart, occurrenceEnd, input.rangeStart, input.rangeEnd)) {
      continue
    }

    instances.push({
      id: `${input.series.id}:${occurrenceStart.toISOString()}`,
      eventId: input.series.id,
      seriesId: input.series.id,
      recurrenceInstanceStartAt: occurrenceStart,
      startsAt: occurrenceStart,
      endsAt: occurrenceEnd,
      allDay: input.series.allDay,
      isException: false,
    })

    if (instances.length > maxInstances) {
      throw new Error(`Calendar range expands to more than ${maxInstances} event instances`)
    }
  }

  return instances.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}
