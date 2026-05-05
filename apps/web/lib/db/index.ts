import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema/index.ts'
import { runWithOrgDatabaseScope } from './rls.ts'
import { getDatabaseUrl } from './connection-string.ts'

const connectionString = getDatabaseUrl()
const maxConnections = getMaxConnections()

// Disable prefetch as it is not supported for "transaction" pool mode
export const client = getPostgresClient()

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

function getPostgresClient(): Sql {
  if (!shouldCacheClient()) return createPostgresClient()

  const globalForDb = globalThis as typeof globalThis & {
    __ctOpsPostgresClient?: Sql
  }
  globalForDb.__ctOpsPostgresClient ??= createPostgresClient()
  return globalForDb.__ctOpsPostgresClient
}

function createPostgresClient(): Sql {
  return postgres(connectionString, {
    prepare: false,
    max: maxConnections,
    ...getConnectionLifecycleOptions(),
  })
}

function shouldCacheClient(): boolean {
  return process.env['NODE_ENV'] !== 'production' || process.env['E2E'] === '1'
}

function getConnectionLifecycleOptions(): { idle_timeout?: number; max_lifetime?: number } {
  if (process.env['E2E'] !== '1') return {}

  return {
    idle_timeout: getPositiveIntegerEnv('POSTGRES_IDLE_TIMEOUT', 1),
    max_lifetime: getPositiveIntegerEnv('POSTGRES_MAX_LIFETIME', 30),
  }
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }

  return value
}
