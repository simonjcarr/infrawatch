import { type APIRequestContext } from '@playwright/test'
import { createId } from '@paralleldrive/cuid2'
import { getTestDb } from './db'

export const TEST_USER = {
  email: 'e2e@example.com',
  password: 'TestPassword123!',
  name: 'E2E Test User',
} as const

export const TEST_ORG = {
  name: 'E2E Test Org',
  slug: 'e2e-test-org',
} as const

// Idempotent. Calls Better Auth's public sign-up HTTP endpoint (which hashes
// the password correctly and creates the matching `account` row), then
// attaches the user to an organisation and promotes them to admin so the
// dashboard layout guards pass.
export async function seedOrgAndUser(request: APIRequestContext): Promise<void> {
  const sql = getTestDb()

  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM "user" WHERE email = ${TEST_USER.email} LIMIT 1
  `
  if (existing.length === 0) {
    const res = await request.post('/api/auth/sign-up/email', {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
        name: TEST_USER.name,
      },
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`sign-up failed: ${res.status()} ${body}`)
    }
  }

  await sql`
    INSERT INTO organisations (id, name, slug)
    VALUES (${createId()}, ${TEST_ORG.name}, ${TEST_ORG.slug})
    ON CONFLICT (slug) DO NOTHING
  `

  await sql`
    UPDATE "user"
    SET organisation_id = (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
        email_verified = true,
        role = 'org_admin',
        is_active = true
    WHERE email = ${TEST_USER.email}
  `

  // Sign-up auto-creates a session — drop it so the login test exercises a
  // fresh form submission.
  await sql`DELETE FROM "session" WHERE user_id = (SELECT id FROM "user" WHERE email = ${TEST_USER.email})`
}
