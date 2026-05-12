import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { instanceSettings } from './instance-settings.ts'
import { users } from './auth.ts'

export const ansibleCredentialProfiles = pgTable('ansible_credential_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  instanceId: text('instance_id').notNull().references(() => instanceSettings.id),
  name: text('name').notNull(),
  username: text('username').notNull(),
  privateKeyEncrypted: text('private_key_encrypted').notNull(),
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('ansible_credential_profiles_instance_idx').on(t.instanceId, t.name),
])

export type AnsibleCredentialProfile = typeof ansibleCredentialProfiles.$inferSelect
export type NewAnsibleCredentialProfile = typeof ansibleCredentialProfiles.$inferInsert
