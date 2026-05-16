import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

import { instanceSettings } from './instance-settings.ts'

export type ModuleType = 'ansible' | 'ct-cve'
export type ModuleAuthMode = 'none' | 'service-token-hmac'
export type ModuleTlsMode = 'public-ca' | 'private-ca' | 'pinned-certificate' | 'insecure'

export const moduleConnections = pgTable('module_connections', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  instanceId: text('instance_id').notNull().references(() => instanceSettings.id),
  moduleType: text('module_type').$type<ModuleType>().notNull(),
  enabled: boolean('enabled').notNull().default(false),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  contractVersion: text('contract_version').notNull(),
  authMode: text('auth_mode').$type<ModuleAuthMode>().notNull().default('service-token-hmac'),
  tokenId: text('token_id'),
  tokenSecretEncrypted: text('token_secret_encrypted'),
  tlsMode: text('tls_mode').$type<ModuleTlsMode>().notNull().default('public-ca'),
  caCertificate: text('ca_certificate'),
  serverCertificateSha256: text('server_certificate_sha256'),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('module_connections_instance_type_uniq').on(table.instanceId, table.moduleType),
  index('module_connections_instance_enabled_idx').on(table.instanceId, table.enabled),
  index('module_connections_type_idx').on(table.moduleType),
])

export type ModuleConnection = typeof moduleConnections.$inferSelect
export type NewModuleConnection = typeof moduleConnections.$inferInsert
