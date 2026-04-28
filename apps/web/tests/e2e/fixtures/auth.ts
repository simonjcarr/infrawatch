import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getBetterAuthSecret } from '../../../lib/auth/env'
import { makeSessionCookieValue } from '../../../lib/auth/session-cookie'
import { getTestDb } from './db'
import { TEST_USER } from './seed'

export const STORAGE_STATE_PATH = path.resolve(
  __dirname,
  '..',
  '.auth',
  'user.json',
)

export async function getStorageStatePath(baseURL: string): Promise<string> {
  return createAndCacheStorageState(baseURL)
}

async function createAndCacheStorageState(baseURL: string): Promise<string> {
  const sql = getTestDb()
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM "user" WHERE email = ${TEST_USER.email} LIMIT 1
  `
  const userId = rows[0]?.id
  if (!userId) {
    throw new Error(`E2E test user ${TEST_USER.email} has not been seeded`)
  }

  const sessionToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await sql`
    INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id)
    VALUES (${createId()}, ${expiresAt}, ${sessionToken}, NOW(), NOW(), ${userId})
  `

  const cookieValue = await makeSessionCookieValue(sessionToken, getBetterAuthSecret())
  const url = new URL(baseURL)

  await mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true })
  await writeFile(
    STORAGE_STATE_PATH,
    JSON.stringify(
      {
        cookies: [
          {
            name: 'better-auth.session_token',
            value: cookieValue,
            domain: url.hostname,
            path: '/',
            expires: Math.floor(expiresAt.getTime() / 1000),
            httpOnly: true,
            secure: url.protocol === 'https:',
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
  )

  return STORAGE_STATE_PATH
}
