import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'
import { users } from './auth'

export type TerminalSessionStatus = 'pending' | 'active' | 'ended' | 'error'

export const terminalSessions = pgTable('terminal_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  userId: text('user_id').notNull().references(() => users.id),
  sessionId: text('session_id').notNull().unique(),
  username: text('username'),
  websocketTokenHash: text('websocket_token_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  status: text('status').notNull().default('pending').$type<TerminalSessionStatus>(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  recording: text('recording'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('terminal_sessions_org_host_idx').on(t.organisationId, t.hostId),
  index('terminal_sessions_session_id_idx').on(t.sessionId),
])

export type TerminalSession = typeof terminalSessions.$inferSelect
export type NewTerminalSession = typeof terminalSessions.$inferInsert
