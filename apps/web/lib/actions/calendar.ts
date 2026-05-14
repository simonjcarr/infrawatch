'use server'

import { createId } from '@paralleldrive/cuid2'
import { and, asc, eq, gt, ilike, inArray, isNull, isNotNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { writeAuditEvent } from '@/lib/audit/events'
import { requireInstanceAccess, requireInstanceWriteAccess } from '@/lib/actions/action-auth'
import { db } from '@/lib/db'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_PARTICIPANT_ROLES,
  CALENDAR_RECURRENCE_FREQUENCIES,
  CALENDAR_WEEKDAYS,
  calendarEventHosts,
  calendarEventParticipants,
  calendarEvents,
  hosts,
  users,
  type CalendarEvent,
  type CalendarEventCategory,
  type CalendarEventStatus,
  type CalendarParticipantRole,
  type CalendarRecurrenceRule,
} from '@/lib/db/schema'
import {
  expandCalendarSeries,
  validateCalendarRange,
  type ExpandedCalendarInstance,
} from '@/lib/calendar/recurrence'
import { createRateLimiter } from '@/lib/rate-limit'
import { escapeLikePattern } from '@/lib/utils'
import { logError } from '@/lib/logging'

const MAX_EVENT_DURATION_DAYS = 31
const MAX_HOST_LINKS = 100
const MAX_PARTICIPANTS = 50
const MAX_SELECTOR_RESULTS = 100
const MAX_LISTED_INSTANCES = 2000
const DAY_MS = 24 * 60 * 60 * 1000

const calendarMutationLimiter = createRateLimiter({
  scope: 'calendar:mutations',
  windowMs: 60_000,
  max: 60,
})

const dateStringSchema = z.string().min(1)

const recurrenceRuleSchema = z.object({
  freq: z.enum(CALENDAR_RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(99).default(1),
  byWeekday: z.array(z.enum(CALENDAR_WEEKDAYS)).max(7).optional(),
  count: z.number().int().min(1).max(500).optional(),
  until: dateStringSchema.optional(),
}).strict().refine((rule) => !(rule.count && rule.until), {
  message: 'Choose either an occurrence count or an end date, not both',
})

const participantInputSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(CALENDAR_PARTICIPANT_ROLES),
})

const calendarEventInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional().nullable(),
  startsAt: dateStringSchema,
  endsAt: dateStringSchema,
  allDay: z.boolean().default(false),
  timezone: z.string().trim().min(1).max(100).default('UTC'),
  status: z.enum(CALENDAR_EVENT_STATUSES).default('planned'),
  category: z.enum(CALENDAR_EVENT_CATEGORIES).default('maintenance'),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  hostIds: z.array(z.string().min(1)).max(MAX_HOST_LINKS).default([]),
  participants: z.array(participantInputSchema).max(MAX_PARTICIPANTS).default([]),
  clientRequestId: z.string().trim().min(8).max(120).optional(),
})

const listCalendarInputSchema = z.object({
  startsAt: dateStringSchema,
  endsAt: dateStringSchema,
  search: z.string().max(200).optional(),
})

const searchInputSchema = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(MAX_SELECTOR_RESULTS).optional(),
})

const moveCalendarEventInputSchema = z.object({
  eventId: z.string().min(1),
  recurrenceInstanceStartAt: dateStringSchema.optional().nullable(),
  startsAt: dateStringSchema,
  endsAt: dateStringSchema,
  allDay: z.boolean().optional(),
  scope: z.enum(['this', 'series']).default('this'),
})

const deleteCalendarEventInputSchema = z.object({
  eventId: z.string().min(1),
  recurrenceInstanceStartAt: dateStringSchema.optional().nullable(),
  scope: z.enum(['this', 'series']).default('series'),
})

export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>

export interface CalendarHostOption {
  id: string
  hostname: string
  displayName: string | null
  os: string | null
}

export interface CalendarUserOption {
  id: string
  name: string
  email: string
  role: string
}

export interface CalendarParticipantView extends CalendarUserOption {
  participantRole: CalendarParticipantRole
}

export interface CalendarEventInstanceView {
  id: string
  eventId: string
  seriesId: string | null
  recurrenceInstanceStartAt: string | null
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  timezone: string
  status: CalendarEventStatus
  category: CalendarEventCategory
  recurrenceRule: CalendarRecurrenceRule | null
  isRecurring: boolean
  isException: boolean
  hosts: CalendarHostOption[]
  participants: CalendarParticipantView[]
}

export interface HostCalendarEventView {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  timezone: string
  status: CalendarEventStatus
  category: CalendarEventCategory
  isRecurring: boolean
  isLinkedToCurrentUser: boolean
}

type ParsedCalendarInput = Omit<CalendarEventInput, 'startsAt' | 'endsAt' | 'recurrenceRule'> & {
  startsAt: Date
  endsAt: Date
  recurrenceRule: CalendarRecurrenceRule | null
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid date`)
  }
  return date
}

function normaliseRecurrenceRule(rule: z.infer<typeof recurrenceRuleSchema> | null | undefined): CalendarRecurrenceRule | null {
  if (!rule) return null

  const normalised: CalendarRecurrenceRule = {
    freq: rule.freq,
    interval: Math.max(1, Math.trunc(rule.interval)),
  }
  if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length > 0) {
    normalised.byWeekday = Array.from(new Set(rule.byWeekday))
  }
  if (rule.count != null) {
    normalised.count = Math.trunc(rule.count)
  }
  if (rule.until) {
    normalised.until = parseDate(rule.until, 'Recurrence end date').toISOString()
  }
  return normalised
}

function parseCalendarInput(input: unknown): { data: ParsedCalendarInput } | { error: string } {
  const parsed = calendarEventInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid calendar event' }
  }

  try {
    const startsAt = parseDate(parsed.data.startsAt, 'Start time')
    const endsAt = parseDate(parsed.data.endsAt, 'End time')
    if (endsAt <= startsAt) {
      return { error: 'End time must be after start time' }
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_DURATION_DAYS * DAY_MS) {
      return { error: `Calendar events cannot be longer than ${MAX_EVENT_DURATION_DAYS} days` }
    }

    return {
      data: {
        ...parsed.data,
        startsAt,
        endsAt,
        recurrenceRule: normaliseRecurrenceRule(parsed.data.recurrenceRule),
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid calendar dates' }
  }
}

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

async function ensureHostsBelongToInstance(instanceId: string, hostIds: readonly string[]): Promise<{ ok: true; hostIds: string[] } | { error: string }> {
  const uniqueHostIds = uniqueValues(hostIds)
  if (uniqueHostIds.length === 0) return { ok: true, hostIds: [] }

  const rows = await db.query.hosts.findMany({
    where: and(inArray(hosts.id, uniqueHostIds), eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)),
    columns: { id: true },
  })
  if (rows.length !== uniqueHostIds.length) {
    return { error: 'One or more selected hosts were not found in this instance' }
  }
  return { ok: true, hostIds: uniqueHostIds }
}

async function ensureUsersBelongToInstance(
  instanceId: string,
  participants: readonly z.infer<typeof participantInputSchema>[],
): Promise<{ ok: true; participants: Array<{ userId: string; role: CalendarParticipantRole }> } | { error: string }> {
  const byUser = new Map<string, CalendarParticipantRole>()
  for (const participant of participants) {
    byUser.set(participant.userId, participant.role)
  }
  const userIds = Array.from(byUser.keys())
  if (userIds.length === 0) return { ok: true, participants: [] }

  const rows = await db.query.users.findMany({
    where: and(
      inArray(users.id, userIds),
      eq(users.instanceId, instanceId),
      eq(users.isActive, true),
      isNull(users.deletedAt),
    ),
    columns: { id: true },
  })
  if (rows.length !== userIds.length) {
    return { error: 'One or more selected participants were not found in this instance' }
  }
  return {
    ok: true,
    participants: userIds.map((userId) => ({ userId, role: byUser.get(userId) ?? 'observer' })),
  }
}

async function replaceLinks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  instanceId: string,
  eventId: string,
  hostIds: readonly string[],
  participants: readonly { userId: string; role: CalendarParticipantRole }[],
): Promise<void> {
  await tx.delete(calendarEventHosts).where(eq(calendarEventHosts.eventId, eventId))
  await tx.delete(calendarEventParticipants).where(eq(calendarEventParticipants.eventId, eventId))

  if (hostIds.length > 0) {
    await tx.insert(calendarEventHosts).values(hostIds.map((hostId) => ({ instanceId: instanceId, eventId, hostId })))
  }

  if (participants.length > 0) {
    await tx.insert(calendarEventParticipants).values(
      participants.map((participant) => ({
        instanceId: instanceId,
        eventId,
        userId: participant.userId,
        role: participant.role,
      })),
    )
  }
}

async function copyLinksFromEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  instanceId: string,
  fromEventId: string,
  toEventId: string,
): Promise<void> {
  const [hostRows, participantRows] = await Promise.all([
    tx.query.calendarEventHosts.findMany({
      where: and(eq(calendarEventHosts.eventId, fromEventId), eq(calendarEventHosts.instanceId, instanceId)),
    }),
    tx.query.calendarEventParticipants.findMany({
      where: and(eq(calendarEventParticipants.eventId, fromEventId), eq(calendarEventParticipants.instanceId, instanceId)),
    }),
  ])

  await replaceLinks(
    tx,
    instanceId,
    toEventId,
    hostRows.map((row) => row.hostId),
    participantRows.map((row) => ({ userId: row.userId, role: row.role })),
  )
}

async function checkMutationLimit(instanceId: string, userId: string): Promise<{ ok: true } | { error: string }> {
  if (await calendarMutationLimiter.check(`${instanceId}:${userId}`)) {
    return { ok: true }
  }
  return { error: 'Too many calendar changes. Please wait a minute and try again.' }
}

function parseListRange(input: unknown): { startsAt: Date; endsAt: Date; search: string | null } | { error: string } {
  const parsed = listCalendarInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid calendar range' }
  }

  try {
    const startsAt = parseDate(parsed.data.startsAt, 'Range start')
    const endsAt = parseDate(parsed.data.endsAt, 'Range end')
    validateCalendarRange({ startsAt, endsAt })
    return { startsAt, endsAt, search: parsed.data.search?.trim() || null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid calendar range' }
  }
}

function rowOverlapsRange(row: CalendarEvent, startsAt: Date, endsAt: Date): boolean {
  return row.startsAt < endsAt && row.endsAt > startsAt
}

function rowToSeries(row: CalendarEvent) {
  if (!row.recurrenceRule) return null
  return {
    id: row.id,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    timezone: row.timezone,
    recurrenceRule: row.recurrenceRule,
  }
}

function matchesSearch(row: CalendarEvent, search: string | null): boolean {
  if (!search) return true
  const needle = search.toLowerCase()
  return row.title.toLowerCase().includes(needle) || (row.description ?? '').toLowerCase().includes(needle)
}

async function hydrateInstances(rowsById: Map<string, CalendarEvent>, instances: ExpandedCalendarInstance[]): Promise<CalendarEventInstanceView[]> {
  const eventIds = Array.from(new Set(instances.map((instance) => instance.eventId)))
  if (eventIds.length === 0) return []

  const [hostRows, participantRows] = await Promise.all([
    db
      .select({
        eventId: calendarEventHosts.eventId,
        id: hosts.id,
        hostname: hosts.hostname,
        displayName: hosts.displayName,
        os: hosts.os,
      })
      .from(calendarEventHosts)
      .innerJoin(hosts, eq(calendarEventHosts.hostId, hosts.id))
      .where(and(inArray(calendarEventHosts.eventId, eventIds), isNull(hosts.deletedAt))),
    db
      .select({
        eventId: calendarEventParticipants.eventId,
        participantRole: calendarEventParticipants.role,
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(calendarEventParticipants)
      .innerJoin(users, eq(calendarEventParticipants.userId, users.id))
      .where(and(inArray(calendarEventParticipants.eventId, eventIds), isNull(users.deletedAt))),
  ])

  const hostsByEvent = new Map<string, CalendarHostOption[]>()
  for (const row of hostRows) {
    const list = hostsByEvent.get(row.eventId) ?? []
    list.push({ id: row.id, hostname: row.hostname, displayName: row.displayName, os: row.os })
    hostsByEvent.set(row.eventId, list)
  }

  const participantsByEvent = new Map<string, CalendarParticipantView[]>()
  for (const row of participantRows) {
    const list = participantsByEvent.get(row.eventId) ?? []
    list.push({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      participantRole: row.participantRole,
    })
    participantsByEvent.set(row.eventId, list)
  }

  return instances.map((instance) => {
    const row = rowsById.get(instance.eventId) ?? (instance.seriesId ? rowsById.get(instance.seriesId) : undefined)
    if (!row) {
      throw new Error(`Calendar event ${instance.eventId} was not found while hydrating instances`)
    }
    return {
      id: instance.id,
      eventId: instance.eventId,
      seriesId: instance.seriesId,
      recurrenceInstanceStartAt: instance.recurrenceInstanceStartAt.toISOString(),
      title: row.title,
      description: row.description,
      startsAt: instance.startsAt.toISOString(),
      endsAt: instance.endsAt.toISOString(),
      allDay: instance.allDay,
      timezone: row.timezone,
      status: row.status,
      category: row.category,
      recurrenceRule: row.recurrenceRule,
      isRecurring: Boolean(row.recurrenceRule || instance.seriesId),
      isException: instance.isException,
      hosts: hostsByEvent.get(instance.eventId) ?? [],
      participants: participantsByEvent.get(instance.eventId) ?? [],
    }
  })
}

export async function listCalendarEvents(
  instanceId: string,
  input: unknown,
): Promise<{ events: CalendarEventInstanceView[] } | { error: string }> {
  await requireInstanceAccess(instanceId)
  const range = parseListRange(input)
  if ('error' in range) return range

  try {
    const [rangeRows, seriesRows] = await Promise.all([
      db.query.calendarEvents.findMany({
        where: and(
          eq(calendarEvents.instanceId, instanceId),
          isNull(calendarEvents.deletedAt),
          lt(calendarEvents.startsAt, range.endsAt),
          gt(calendarEvents.endsAt, range.startsAt),
        ),
        orderBy: [asc(calendarEvents.startsAt)],
      }),
      db.query.calendarEvents.findMany({
        where: and(
          eq(calendarEvents.instanceId, instanceId),
          isNull(calendarEvents.deletedAt),
          isNull(calendarEvents.seriesId),
          isNotNull(calendarEvents.recurrenceRule),
        ),
      }),
    ])

    const rowsById = new Map<string, CalendarEvent>()
    for (const row of [...rangeRows, ...seriesRows]) {
      rowsById.set(row.id, row)
    }

    const seriesIds = seriesRows.map((row) => row.id)
    const exceptionRows = seriesIds.length > 0
      ? await db.query.calendarEvents.findMany({
          where: and(
            eq(calendarEvents.instanceId, instanceId),
            isNull(calendarEvents.deletedAt),
            inArray(calendarEvents.seriesId, seriesIds),
          ),
        })
      : []
    for (const row of exceptionRows) {
      rowsById.set(row.id, row)
    }

    const instances: ExpandedCalendarInstance[] = []
    for (const row of rangeRows) {
      if (row.seriesId || row.recurrenceRule) continue
      if (!matchesSearch(row, range.search)) continue
      instances.push({
        id: row.id,
        eventId: row.id,
        seriesId: null,
        recurrenceInstanceStartAt: row.startsAt,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        allDay: row.allDay,
        isException: false,
      })
    }

    for (const row of seriesRows) {
      if (!matchesSearch(row, range.search)) continue
      const series = rowToSeries(row)
      if (!series) continue
      instances.push(
        ...expandCalendarSeries({
          series,
          rangeStart: range.startsAt,
          rangeEnd: range.endsAt,
          exceptions: exceptionRows,
        }),
      )
    }
    if (instances.length > MAX_LISTED_INSTANCES) {
      return { error: `Calendar range contains more than ${MAX_LISTED_INSTANCES} events. Narrow the visible range or search term.` }
    }

    const events = await hydrateInstances(
      rowsById,
      instances.filter((instance) => rowOverlapsRange({ ...rowsById.get(instance.eventId)!, startsAt: instance.startsAt, endsAt: instance.endsAt }, range.startsAt, range.endsAt)),
    )
    return { events: events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) }
  } catch (err) {
    logError('Failed to list calendar events:', err)
    return { error: err instanceof Error ? err.message : 'Failed to load calendar events' }
  }
}

export async function listCalendarEventsForHost(
  instanceId: string,
  hostId: string,
): Promise<{ events: HostCalendarEventView[] } | { error: string }> {
  const session = await requireInstanceAccess(instanceId)
  const parsedHostId = z.string().min(1).safeParse(hostId)
  if (!parsedHostId.success) return { error: 'Host is required' }

  try {
    const rows = await db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        description: calendarEvents.description,
        startsAt: calendarEvents.startsAt,
        endsAt: calendarEvents.endsAt,
        allDay: calendarEvents.allDay,
        timezone: calendarEvents.timezone,
        status: calendarEvents.status,
        category: calendarEvents.category,
        recurrenceRule: calendarEvents.recurrenceRule,
        createdBy: calendarEvents.createdBy,
      })
      .from(calendarEventHosts)
      .innerJoin(
        calendarEvents,
        and(
          eq(calendarEventHosts.eventId, calendarEvents.id),
          eq(calendarEvents.instanceId, instanceId),
          isNull(calendarEvents.deletedAt),
        ),
      )
      .innerJoin(
        hosts,
        and(
          eq(calendarEventHosts.hostId, hosts.id),
          eq(hosts.instanceId, instanceId),
          isNull(hosts.deletedAt),
        ),
      )
      .where(and(
        eq(calendarEventHosts.instanceId, instanceId),
        eq(calendarEventHosts.hostId, parsedHostId.data),
      ))
      .orderBy(asc(calendarEvents.startsAt))
      .limit(250)

    const eventIds = rows.map((row) => row.id)
    const participantRows = eventIds.length > 0
      ? await db.query.calendarEventParticipants.findMany({
          where: and(
            eq(calendarEventParticipants.instanceId, instanceId),
            eq(calendarEventParticipants.userId, session.user.id),
            inArray(calendarEventParticipants.eventId, eventIds),
          ),
          columns: { eventId: true },
        })
      : []
    const currentUserEventIds = new Set(participantRows.map((row) => row.eventId))

    return {
      events: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        allDay: row.allDay,
        timezone: row.timezone,
        status: row.status,
        category: row.category,
        isRecurring: Boolean(row.recurrenceRule),
        isLinkedToCurrentUser: row.createdBy === session.user.id || currentUserEventIds.has(row.id),
      })),
    }
  } catch (err) {
    logError('Failed to list host calendar events:', err)
    return { error: 'Failed to load host calendar events' }
  }
}

export async function searchCalendarHosts(
  instanceId: string,
  input: unknown = {},
): Promise<{ hosts: CalendarHostOption[] } | { error: string }> {
  await requireInstanceAccess(instanceId)
  const parsed = searchInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid host search' }

  const query = parsed.data.query?.trim()
  const limit = parsed.data.limit ?? 50
  const conditions = [eq(hosts.instanceId, instanceId), isNull(hosts.deletedAt)]
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`
    const searchClause = or(ilike(hosts.hostname, pattern), ilike(hosts.displayName, pattern))
    if (searchClause) conditions.push(searchClause)
  }

  const rows = await db.query.hosts.findMany({
    where: and(...conditions),
    columns: { id: true, hostname: true, displayName: true, os: true },
    orderBy: [asc(hosts.hostname)],
    limit,
  })
  return { hosts: rows }
}

export async function searchCalendarUsers(
  instanceId: string,
  input: unknown = {},
): Promise<{ users: CalendarUserOption[] } | { error: string }> {
  await requireInstanceAccess(instanceId)
  const parsed = searchInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid user search' }

  const query = parsed.data.query?.trim()
  const limit = parsed.data.limit ?? 50
  const conditions = [
    eq(users.instanceId, instanceId),
    eq(users.isActive, true),
    isNull(users.deletedAt),
  ]
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`
    const searchClause = or(ilike(users.name, pattern), ilike(users.email, pattern))
    if (searchClause) conditions.push(searchClause)
  }

  const rows = await db.query.users.findMany({
    where: and(...conditions),
    columns: { id: true, name: true, email: true, role: true },
    orderBy: [asc(users.name), asc(users.email)],
    limit,
  })
  return { users: rows }
}

export async function createCalendarEvent(
  instanceId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await requireInstanceWriteAccess(instanceId)
  const limit = await checkMutationLimit(instanceId, session.user.id)
  if ('error' in limit) return limit

  const parsed = parseCalendarInput(input)
  if ('error' in parsed) return parsed

  const hostCheck = await ensureHostsBelongToInstance(instanceId, parsed.data.hostIds)
  if ('error' in hostCheck) return hostCheck
  const participantCheck = await ensureUsersBelongToInstance(instanceId, parsed.data.participants)
  if ('error' in participantCheck) return participantCheck

  try {
    const existingIdempotentEvent = parsed.data.clientRequestId
      ? await db.query.calendarEvents.findFirst({
          where: and(
            eq(calendarEvents.instanceId, instanceId),
            eq(calendarEvents.clientRequestId, parsed.data.clientRequestId),
            isNull(calendarEvents.deletedAt),
          ),
          columns: { id: true },
        })
      : null

    if (existingIdempotentEvent) {
      return { success: true, id: existingIdempotentEvent.id }
    }

    const id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(calendarEvents)
        .values({
          instanceId: instanceId,
          createdBy: session.user.id,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          startsAt: parsed.data.startsAt,
          endsAt: parsed.data.endsAt,
          allDay: parsed.data.allDay,
          timezone: parsed.data.timezone,
          status: parsed.data.status,
          category: parsed.data.category,
          recurrenceRule: parsed.data.recurrenceRule,
          clientRequestId: parsed.data.clientRequestId,
        })
        .returning({ id: calendarEvents.id })

      if (!created) throw new Error('Failed to create calendar event')
      await replaceLinks(tx, instanceId, created.id, hostCheck.hostIds, participantCheck.participants)
      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'calendar.event.created',
        targetType: 'calendar_event',
        targetId: created.id,
        summary: `Created calendar event ${parsed.data.title}`,
        metadata: {
          startsAt: parsed.data.startsAt,
          endsAt: parsed.data.endsAt,
          recurrence: parsed.data.recurrenceRule,
          hostCount: hostCheck.hostIds.length,
          participantCount: participantCheck.participants.length,
        },
      })
      return created.id
    })

    return { success: true, id }
  } catch (err) {
    logError('Failed to create calendar event:', err)
    return { error: 'Failed to create calendar event' }
  }
}

export async function updateCalendarEvent(
  instanceId: string,
  eventId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const session = await requireInstanceWriteAccess(instanceId)
  const limit = await checkMutationLimit(instanceId, session.user.id)
  if ('error' in limit) return limit

  const parsed = parseCalendarInput(input)
  if ('error' in parsed) return parsed

  const hostCheck = await ensureHostsBelongToInstance(instanceId, parsed.data.hostIds)
  if ('error' in hostCheck) return hostCheck
  const participantCheck = await ensureUsersBelongToInstance(instanceId, parsed.data.participants)
  if ('error' in participantCheck) return participantCheck

  const existing = await db.query.calendarEvents.findFirst({
    where: and(eq(calendarEvents.id, eventId), eq(calendarEvents.instanceId, instanceId), isNull(calendarEvents.deletedAt)),
  })
  if (!existing) return { error: 'Calendar event not found' }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(calendarEvents)
        .set({
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          startsAt: parsed.data.startsAt,
          endsAt: parsed.data.endsAt,
          allDay: parsed.data.allDay,
          timezone: parsed.data.timezone,
          status: parsed.data.status,
          category: parsed.data.category,
          recurrenceRule: existing.seriesId ? null : parsed.data.recurrenceRule,
          updatedAt: new Date(),
        })
        .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.instanceId, instanceId)))

      await replaceLinks(tx, instanceId, eventId, hostCheck.hostIds, participantCheck.participants)
      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'calendar.event.updated',
        targetType: 'calendar_event',
        targetId: eventId,
        summary: `Updated calendar event ${parsed.data.title}`,
        metadata: {
          previousTitle: existing.title,
          startsAt: parsed.data.startsAt,
          endsAt: parsed.data.endsAt,
          hostCount: hostCheck.hostIds.length,
          participantCount: participantCheck.participants.length,
        },
      })
    })
    return { success: true }
  } catch (err) {
    logError('Failed to update calendar event:', err)
    return { error: 'Failed to update calendar event' }
  }
}

export async function moveCalendarEventInstance(
  instanceId: string,
  input: unknown,
): Promise<{ success: true; id: string } | { error: string }> {
  const session = await requireInstanceWriteAccess(instanceId)
  const limit = await checkMutationLimit(instanceId, session.user.id)
  if ('error' in limit) return limit

  const parsed = moveCalendarEventInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid calendar move' }

  let startsAt: Date
  let endsAt: Date
  let recurrenceInstanceStartAt: Date | null = null
  try {
    startsAt = parseDate(parsed.data.startsAt, 'Start time')
    endsAt = parseDate(parsed.data.endsAt, 'End time')
    if (parsed.data.recurrenceInstanceStartAt) {
      recurrenceInstanceStartAt = parseDate(parsed.data.recurrenceInstanceStartAt, 'Occurrence start time')
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid calendar move dates' }
  }
  if (endsAt <= startsAt) return { error: 'End time must be after start time' }

  const existing = await db.query.calendarEvents.findFirst({
    where: and(eq(calendarEvents.id, parsed.data.eventId), eq(calendarEvents.instanceId, instanceId), isNull(calendarEvents.deletedAt)),
  })
  if (!existing) return { error: 'Calendar event not found' }

  try {
    const id = await db.transaction(async (tx) => {
      if (existing.recurrenceRule && recurrenceInstanceStartAt && parsed.data.scope === 'this') {
        const existingException = await tx.query.calendarEvents.findFirst({
          where: and(
            eq(calendarEvents.instanceId, instanceId),
            eq(calendarEvents.seriesId, existing.id),
            eq(calendarEvents.recurrenceInstanceStartAt, recurrenceInstanceStartAt),
            isNull(calendarEvents.deletedAt),
          ),
        })

        const exceptionId = existingException?.id ?? createId()
        if (existingException) {
          await tx
            .update(calendarEvents)
            .set({
              title: existing.title,
              description: existing.description,
              startsAt,
              endsAt,
              allDay: parsed.data.allDay ?? existing.allDay,
              timezone: existing.timezone,
              status: existing.status,
              category: existing.category,
              recurrenceRule: null,
              exceptionType: 'modified',
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, existingException.id))
        } else {
          await tx.insert(calendarEvents).values({
            id: exceptionId,
            instanceId: instanceId,
            createdBy: session.user.id,
            title: existing.title,
            description: existing.description,
            startsAt,
            endsAt,
            allDay: parsed.data.allDay ?? existing.allDay,
            timezone: existing.timezone,
            status: existing.status,
            category: existing.category,
            recurrenceRule: null,
            seriesId: existing.id,
            recurrenceInstanceStartAt,
            exceptionType: 'modified',
          })
          await copyLinksFromEvent(tx, instanceId, existing.id, exceptionId)
        }

        await writeAuditEvent(tx, {
          instanceId: instanceId,
          actorUserId: session.user.id,
          action: 'calendar.event.occurrence_moved',
          targetType: 'calendar_event',
          targetId: exceptionId,
          summary: `Moved one occurrence of ${existing.title}`,
          metadata: { seriesId: existing.id, recurrenceInstanceStartAt, startsAt, endsAt },
        })
        return exceptionId
      }

      const nextStartsAt = existing.recurrenceRule && recurrenceInstanceStartAt && parsed.data.scope === 'series'
        ? new Date(existing.startsAt.getTime() + (startsAt.getTime() - recurrenceInstanceStartAt.getTime()))
        : startsAt
      const nextEndsAt = existing.recurrenceRule && recurrenceInstanceStartAt && parsed.data.scope === 'series'
        ? new Date(existing.endsAt.getTime() + (startsAt.getTime() - recurrenceInstanceStartAt.getTime()))
        : endsAt

      await tx
        .update(calendarEvents)
        .set({
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          allDay: parsed.data.allDay ?? existing.allDay,
          updatedAt: new Date(),
        })
        .where(and(eq(calendarEvents.id, existing.id), eq(calendarEvents.instanceId, instanceId)))

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'calendar.event.moved',
        targetType: 'calendar_event',
        targetId: existing.id,
        summary: `Moved calendar event ${existing.title}`,
        metadata: { startsAt: nextStartsAt, endsAt: nextEndsAt, scope: parsed.data.scope },
      })
      return existing.id
    })
    return { success: true, id }
  } catch (err) {
    logError('Failed to move calendar event:', err)
    return { error: 'Failed to move calendar event' }
  }
}

export async function deleteCalendarEvent(
  instanceId: string,
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const session = await requireInstanceWriteAccess(instanceId)
  const limit = await checkMutationLimit(instanceId, session.user.id)
  if ('error' in limit) return limit

  const parsed = deleteCalendarEventInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid calendar delete' }

  const existing = await db.query.calendarEvents.findFirst({
    where: and(eq(calendarEvents.id, parsed.data.eventId), eq(calendarEvents.instanceId, instanceId), isNull(calendarEvents.deletedAt)),
  })
  if (!existing) return { error: 'Calendar event not found' }

  try {
    await db.transaction(async (tx) => {
      if (existing.recurrenceRule && parsed.data.scope === 'this' && parsed.data.recurrenceInstanceStartAt) {
        const recurrenceInstanceStartAt = parseDate(parsed.data.recurrenceInstanceStartAt, 'Occurrence start time')
        await tx.insert(calendarEvents).values({
          instanceId: instanceId,
          createdBy: session.user.id,
          title: existing.title,
          description: existing.description,
          startsAt: recurrenceInstanceStartAt,
          endsAt: new Date(recurrenceInstanceStartAt.getTime() + (existing.endsAt.getTime() - existing.startsAt.getTime())),
          allDay: existing.allDay,
          timezone: existing.timezone,
          status: existing.status,
          category: existing.category,
          seriesId: existing.id,
          recurrenceInstanceStartAt,
          exceptionType: 'cancelled',
        })
      } else {
        await tx
          .update(calendarEvents)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            or(
              and(eq(calendarEvents.id, existing.id), eq(calendarEvents.instanceId, instanceId)),
              and(eq(calendarEvents.seriesId, existing.id), eq(calendarEvents.instanceId, instanceId)),
            ),
          )
      }

      await writeAuditEvent(tx, {
        instanceId: instanceId,
        actorUserId: session.user.id,
        action: 'calendar.event.deleted',
        targetType: 'calendar_event',
        targetId: existing.id,
        summary: `Deleted calendar event ${existing.title}`,
        metadata: { scope: parsed.data.scope, recurrenceInstanceStartAt: parsed.data.recurrenceInstanceStartAt ?? null },
      })
    })
    return { success: true }
  } catch (err) {
    logError('Failed to delete calendar event:', err)
    return { error: 'Failed to delete calendar event' }
  }
}
