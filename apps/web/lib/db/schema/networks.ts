import { pgTable, text, timestamp, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations'
import { hosts } from './hosts'

export const networks = pgTable('networks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  name: text('name').notNull(),
  cidr: text('cidr').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

export const hostNetworkMemberships = pgTable(
  'host_network_memberships',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    hostId: text('host_id')
      .notNull()
      .references(() => hosts.id),
    autoAssigned: boolean('auto_assigned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
  },
  (t) => [
    uniqueIndex('host_network_memberships_network_host_uniq').on(t.networkId, t.hostId),
  ],
)

export type Network = typeof networks.$inferSelect
export type NewNetwork = typeof networks.$inferInsert

export type HostNetworkMembership = typeof hostNetworkMemberships.$inferSelect
export type NewHostNetworkMembership = typeof hostNetworkMemberships.$inferInsert
