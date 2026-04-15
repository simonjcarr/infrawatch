import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Key-value store for system-level configuration that must survive container
 * restarts and volume resets. Not scoped to an organisation.
 *
 * Examples:
 *   key='jwt_private_key'  — RSA private key PEM used to sign agent JWTs
 */
export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
