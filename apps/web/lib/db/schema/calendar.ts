import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { instanceSettings } from './instance-settings.ts'
import { users } from './auth.ts'
import { hosts } from './hosts.ts'

export const CALENDAR_EVENT_STATUSES = ['planned', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const
export const CALENDAR_EVENT_CATEGORIES = ['maintenance', 'patching', 'application', 'change', 'meeting', 'other'] as const
export const CALENDAR_PARTICIPANT_ROLES = ['owner', 'requester', 'implementer', 'approver', 'reviewer', 'observer'] as const
export const CALENDAR_RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export const CALENDAR_WEEKDAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const

export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number]
export type CalendarEventCategory = (typeof CALENDAR_EVENT_CATEGORIES)[number]
export type CalendarParticipantRole = (typeof CALENDAR_PARTICIPANT_ROLES)[number]
export type CalendarRecurrenceFrequency = (typeof CALENDAR_RECURRENCE_FREQUENCIES)[number]
export type CalendarWeekday = (typeof CALENDAR_WEEKDAYS)[number]
export type CalendarExceptionType = 'modified' | 'cancelled'

export interface CalendarRecurrenceRule {
  freq: CalendarRecurrenceFrequency
  interval: number
  byWeekday?: CalendarWeekday[]
  count?: number
  until?: string
}

export const calendarEvents = pgTable('calendar_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  instanceId: text('instance_id').notNull().references(() => instanceSettings.id),
  createdBy: text('created_by').references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  allDay: boolean('all_day').notNull().default(false),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status').notNull().default('planned').$type<CalendarEventStatus>(),
  category: text('category').notNull().default('maintenance').$type<CalendarEventCategory>(),
  recurrenceRule: jsonb('recurrence_rule').$type<CalendarRecurrenceRule | null>(),
  seriesId: text('series_id'),
  recurrenceInstanceStartAt: timestamp('recurrence_instance_start_at', { withTimezone: true }),
  exceptionType: text('exception_type').$type<CalendarExceptionType | null>(),
  clientRequestId: text('client_request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('calendar_events_org_range_idx').on(t.instanceId, t.startsAt, t.endsAt),
  index('calendar_events_org_series_idx').on(t.instanceId, t.seriesId, t.recurrenceInstanceStartAt),
  uniqueIndex('calendar_events_org_client_request_idx').on(t.instanceId, t.clientRequestId),
  uniqueIndex('calendar_events_org_series_occurrence_idx')
    .on(t.instanceId, t.seriesId, t.recurrenceInstanceStartAt)
    .where(sql`${t.seriesId} IS NOT NULL AND ${t.recurrenceInstanceStartAt} IS NOT NULL`),
])

export const calendarEventHosts = pgTable('calendar_event_hosts', {
  instanceId: text('instance_id').notNull().references(() => instanceSettings.id),
  eventId: text('event_id').notNull().references(() => calendarEvents.id, { onDelete: 'cascade' }),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.eventId, t.hostId], name: 'calendar_event_hosts_pk' }),
  index('calendar_event_hosts_org_host_idx').on(t.instanceId, t.hostId),
])

export const calendarEventParticipants = pgTable('calendar_event_participants', {
  instanceId: text('instance_id').notNull().references(() => instanceSettings.id),
  eventId: text('event_id').notNull().references(() => calendarEvents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<CalendarParticipantRole>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.eventId, t.userId], name: 'calendar_event_participants_pk' }),
  index('calendar_event_participants_org_user_idx').on(t.instanceId, t.userId),
])

export type CalendarEvent = typeof calendarEvents.$inferSelect
export type NewCalendarEvent = typeof calendarEvents.$inferInsert
export type CalendarEventHost = typeof calendarEventHosts.$inferSelect
export type NewCalendarEventHost = typeof calendarEventHosts.$inferInsert
export type CalendarEventParticipant = typeof calendarEventParticipants.$inferSelect
export type NewCalendarEventParticipant = typeof calendarEventParticipants.$inferInsert
