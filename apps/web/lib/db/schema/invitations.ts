import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'crypto'
import { organisations } from './organisations.ts'
import { users } from './auth.ts'

export const invitations = pgTable('invitations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  role: text('role').notNull().default('engineer'),
  // 256-bit cryptographically random token — safe for use as a bearer secret.
  token: text('token').notNull().unique().$defaultFn(() => randomBytes(32).toString('hex')),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  invitedById: text('invited_by_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

export type Invitation = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert
