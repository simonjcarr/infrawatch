import { pgTable, text, timestamp, jsonb, integer, boolean } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'

export type LdapSyncStatus = 'success' | 'error' | 'running'

export const ldapConfigurations = pgTable('ldap_configurations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(389),
  useTls: boolean('use_tls').notNull().default(false),
  useStartTls: boolean('use_start_tls').notNull().default(false),
  baseDn: text('base_dn').notNull(),
  bindDn: text('bind_dn').notNull(),
  bindPassword: text('bind_password').notNull(),
  userSearchBase: text('user_search_base'),
  userSearchFilter: text('user_search_filter').notNull().default('(uid={{username}})'),
  groupSearchBase: text('group_search_base'),
  groupSearchFilter: text('group_search_filter'),
  usernameAttribute: text('username_attribute').notNull().default('uid'),
  emailAttribute: text('email_attribute').notNull().default('mail'),
  displayNameAttribute: text('display_name_attribute').notNull().default('cn'),
  enabled: boolean('enabled').notNull().default(true),
  allowLogin: boolean('allow_login').notNull().default(false),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: text('last_sync_status').$type<LdapSyncStatus>(),
  lastSyncError: text('last_sync_error'),
  syncIntervalMinutes: integer('sync_interval_minutes').default(60),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

export type LdapConfiguration = typeof ldapConfigurations.$inferSelect
export type NewLdapConfiguration = typeof ldapConfigurations.$inferInsert
