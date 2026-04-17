import { pgTable, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'

export type DomainAccountStatus = 'active' | 'disabled' | 'locked' | 'expired'

export const domainAccounts = pgTable('domain_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  username: text('username').notNull(),
  displayName: text('display_name'),
  email: text('email'),
  status: text('status').notNull().$type<DomainAccountStatus>().default('active'),
  passwordExpiresAt: timestamp('password_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
}, (t) => [
  uniqueIndex('domain_accounts_org_username_idx').on(t.organisationId, t.username),
  index('domain_accounts_org_status_idx').on(t.organisationId, t.status),
])

export type DomainAccount = typeof domainAccounts.$inferSelect
export type NewDomainAccount = typeof domainAccounts.$inferInsert
