import { pgTable, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'

export type DomainAccountSource = 'ldap' | 'active_directory' | 'manual'
export type DomainAccountStatus = 'active' | 'disabled' | 'locked' | 'expired'

export const domainAccounts = pgTable('domain_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  username: text('username').notNull(),
  displayName: text('display_name'),
  email: text('email'),
  source: text('source').notNull().$type<DomainAccountSource>().default('manual'),
  distinguishedName: text('distinguished_name'),
  samAccountName: text('sam_account_name'),
  userPrincipalName: text('user_principal_name'),
  groups: jsonb('groups').$type<string[]>(),
  status: text('status').notNull().$type<DomainAccountStatus>().default('active'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (t) => [
  uniqueIndex('domain_accounts_org_source_username_idx').on(t.organisationId, t.source, t.username),
  index('domain_accounts_org_status_idx').on(t.organisationId, t.status),
  index('domain_accounts_org_source_idx').on(t.organisationId, t.source),
])

export type DomainAccount = typeof domainAccounts.$inferSelect
export type NewDomainAccount = typeof domainAccounts.$inferInsert
