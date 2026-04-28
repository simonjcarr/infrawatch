import { pgTable, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import type { TagPair } from './tags.ts'

// A host filter expressed as a discriminated-union of optional predicates.
// All present fields AND together. Match semantics:
//   - hostnameGlob       fnmatch-style pattern (e.g. "web-*.prod")
//   - hostnameContains   case-insensitive substring
//   - ipCidrs            ANY of the host's ip_addresses ∈ ANY cidr
//   - networkInterfaceName  case-insensitive match on metadata.network_interfaces[].name
//   - os                 exact match within list (linux | windows | darwin)
//   - osVersionContains  case-insensitive substring
//   - arch               exact match within list
//   - status             exact match within list
//   - hasTags            host has (key,value) or (key, *) for every entry
//   - lacksTags          host has none of the entries
export interface HostFilter {
  hostnameGlob?: string
  hostnameContains?: string
  ipCidrs?: string[]
  networkInterfaceName?: string
  os?: string[]
  osVersionContains?: string
  arch?: string[]
  status?: Array<'online' | 'offline' | 'unknown'>
  hasTags?: Array<{ key: string; value?: string }>
  lacksTags?: Array<{ key: string; value?: string }>
}

export const tagRules = pgTable('tag_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id),
  name: text('name').notNull(),
  filter: jsonb('filter').$type<HostFilter>().notNull(),
  tags: jsonb('tags').$type<TagPair[]>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type TagRule = typeof tagRules.$inferSelect
export type NewTagRule = typeof tagRules.$inferInsert
