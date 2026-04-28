import { sql } from 'drizzle-orm'

type TransactionScope<DB> = {
  transaction: <T>(run: (transaction: DB) => Promise<T>) => Promise<T>
}

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>
}

export async function runWithOrgDatabaseScope<DB, T>(
  rootDb: TransactionScope<DB>,
  orgId: string,
  run: (db: DB) => Promise<T>,
): Promise<T> {
  return await rootDb.transaction(async (transaction) => {
    await applyOrgSetting(transaction as SqlExecutor, orgId)
    return await run(transaction)
  })
}

async function applyOrgSetting(connection: SqlExecutor, orgId: string) {
  await connection.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`)
}
