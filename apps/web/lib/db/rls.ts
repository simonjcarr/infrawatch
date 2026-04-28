import { sql } from 'drizzle-orm'

export async function runWithOrgDatabaseScope<DB, T>(
  rootDb: {
    transaction: (run: (transaction: DB) => Promise<T>) => Promise<T>
  },
  orgId: string,
  run: (db: DB) => Promise<T>,
): Promise<T> {
  return await rootDb.transaction(async (transaction) => {
    await applyOrgSetting(transaction, orgId)
    return await run(transaction)
  })
}

async function applyOrgSetting(connection: any, orgId: string) {
  await connection.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`)
}
