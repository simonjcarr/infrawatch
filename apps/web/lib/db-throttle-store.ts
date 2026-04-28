import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { securityThrottles } from './db/schema'
import type { ThrottleState, ThrottleStore } from './throttle-store'

function normaliseRow(row?: {
  hits: number[] | null
  lockout_level: number | string
  locked_until: Date | string | null
}): ThrottleState {
  if (!row) {
    return { hits: [], lockoutLevel: 0, lockedUntil: 0 }
  }

  return {
    hits: Array.isArray(row.hits) ? row.hits.filter((hit) => Number.isFinite(hit)) : [],
    lockoutLevel: Number(row.lockout_level) || 0,
    lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : 0,
  }
}

function serialiseState(state: ThrottleState) {
  return {
    hits: state.hits,
    lockoutLevel: Math.max(0, Math.trunc(state.lockoutLevel)),
    lockedUntil: state.lockedUntil > 0 ? new Date(state.lockedUntil) : null,
    updatedAt: new Date(),
  }
}

export const dbThrottleStore: ThrottleStore = {
  async transact(scope, key, apply) {
    return db.transaction(async (tx) => {
      await tx
        .insert(securityThrottles)
        .values({
          scope,
          key,
          hits: [],
          lockoutLevel: 0,
        })
        .onConflictDoNothing()

      const rows = await tx.execute<{
        hits: number[] | null
        lockout_level: number | string
        locked_until: Date | null
      }>(sql`
        SELECT hits, lockout_level, locked_until
        FROM security_throttles
        WHERE scope = ${scope} AND key = ${key}
        FOR UPDATE
      `)

      const current = normaliseRow(Array.from(rows)[0])
      const outcome = await apply(current)

      await tx
        .update(securityThrottles)
        .set(serialiseState(outcome.state))
        .where(and(eq(securityThrottles.scope, scope), eq(securityThrottles.key, key)))

      return outcome.result
    })
  },
  async clear(scope, key) {
    await db
      .delete(securityThrottles)
      .where(and(eq(securityThrottles.scope, scope), eq(securityThrottles.key, key)))
  },
}
