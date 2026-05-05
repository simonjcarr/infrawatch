import { lte } from 'drizzle-orm'

import { db } from '../../db/index.ts'
import { ctCveServiceNonces } from '../../db/schema/index.ts'
import type { CtCveNonceStore } from './service-token.ts'

export const dbCtCveNonceStore: CtCveNonceStore = {
  async remember(tokenId, nonce, expiresAt, now = new Date()) {
    await db.delete(ctCveServiceNonces).where(lte(ctCveServiceNonces.expiresAt, now))

    const inserted = await db
      .insert(ctCveServiceNonces)
      .values({ tokenId, nonce, expiresAt })
      .onConflictDoNothing()
      .returning({ nonce: ctCveServiceNonces.nonce })

    return inserted.length === 1
  },
}
