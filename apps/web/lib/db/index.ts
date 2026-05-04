import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'
import { runWithOrgDatabaseScope } from './rls.ts'
import { getDatabaseUrl } from './connection-string.ts'

const connectionString = getDatabaseUrl()
const maxConnections = getMaxConnections()

// Disable prefetch as it is not supported for "transaction" pool mode
export const client = postgres(connectionString, { prepare: false, max: maxConnections })

const rootDb = drizzle(client, { schema })

export const db = rootDb
export type Database = typeof rootDb
export type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]

export async function withOrgDatabaseScope<T>(
  orgId: string,
  run: (db: TransactionDatabase) => Promise<T>,
): Promise<T> {
  return runWithOrgDatabaseScope<TransactionDatabase, T>(rootDb, orgId, run)
}

function getMaxConnections(): number {
  const raw = process.env['POSTGRES_POOL_MAX']
  if (!raw) return 10

  const max = Number(raw)
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('POSTGRES_POOL_MAX must be a positive integer')
  }

  return max
}
