import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const securityThrottles = pgTable('security_throttles', {
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  hits: jsonb('hits').notNull().$type<number[]>().default([]),
  lockoutLevel: integer('lockout_level').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.key], name: 'security_throttles_pk' }),
])
