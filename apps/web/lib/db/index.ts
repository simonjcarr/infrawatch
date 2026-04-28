import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'
import { runWithOrgDatabaseScope } from './rls.ts'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required')
}

// Disable prefetch as it is not supported for "transaction" pool mode
export const client = postgres(connectionString, { prepare: false })

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
