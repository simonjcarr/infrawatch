import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { hosts } from './hosts.ts'

export type AgentQueryType = 'list_ports' | 'list_services'
export type AgentQueryStatus = 'pending' | 'complete' | 'error'

export interface PortInfoResult {
  port: number
  protocol: string
  process?: string
}

export interface ServiceInfoResult {
  name: string
  load_state: string
  active_sub: string
}

export type AgentQueryResultPayload =
  | { ports: PortInfoResult[] }
  | { services: ServiceInfoResult[] }

export const agentQueries = pgTable('agent_queries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  organisationId: text('organisation_id').notNull().references(() => organisations.id),
  hostId: text('host_id').notNull().references(() => hosts.id),
  queryType: text('query_type').notNull().$type<AgentQueryType>(),
  status: text('status').notNull().default('pending').$type<AgentQueryStatus>(),
  result: jsonb('result').$type<AgentQueryResultPayload>(),
  error: text('error'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (table) => [
  index('agent_queries_host_status_idx').on(table.hostId, table.status),
  index('agent_queries_org_idx').on(table.organisationId, table.requestedAt),
])

export type AgentQueryRow = typeof agentQueries.$inferSelect
export type NewAgentQuery = typeof agentQueries.$inferInsert
