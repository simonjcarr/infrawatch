import { hashPassword } from 'better-auth/crypto'
import { createId } from '@paralleldrive/cuid2'
import { getTestDb } from './db'

export const TEST_USER = {
  email: 'e2e@example.com',
  password: 'TestPassword123!',
  name: 'E2E Test User',
} as const

export const TEST_PASSWORD_MANAGER_MEMBER = {
  email: 'password-manager-member@example.com',
  name: 'Password Manager Member',
} as const

export const TEST_ORG = {
  name: 'E2E Test Org',
  slug: 'e2e-test-org',
} as const

export async function getSeededTestUserContext(): Promise<{
  instanceId: string
  userId: string
}> {
  const sql = getTestDb()
  const rows = await sql<Array<{ instance_id: string | null; user_id: string }>>`
    SELECT organisation_id AS instance_id, id AS user_id
    FROM "user"
    WHERE email = ${TEST_USER.email}
    LIMIT 1
  `
  const row = rows[0]
  if (!row?.instance_id) {
    throw new Error(`seeded test user not found or missing instance membership: ${TEST_USER.email}`)
  }
  return {
    instanceId: row.instance_id,
    userId: row.user_id,
  }
}

let testUserPasswordHash: string | null = null

async function getTestUserPasswordHash(): Promise<string> {
  testUserPasswordHash ??= await hashPassword(TEST_USER.password)
  return testUserPasswordHash
}

// Idempotent deterministic baseline for E2E tests. It writes Better Auth's
// required user/account rows directly so per-test isolation does not have to
// round-trip through the app server before each spec.
export async function seedOrgAndUser(): Promise<void> {
  const sql = getTestDb()
  const orgId = createId()
  const userId = createId()
  const passwordHash = await getTestUserPasswordHash()

  await sql`
    INSERT INTO organisations (id, name, slug)
    VALUES (${orgId}, ${TEST_ORG.name}, ${TEST_ORG.slug})
    ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name
  `

  await sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      created_at,
      updated_at,
      organisation_id,
      role,
      roles,
      is_active
    )
    VALUES (
      ${userId},
      ${TEST_USER.name},
      ${TEST_USER.email},
      true,
      NOW(),
      NOW(),
      (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
      'org_admin',
      '[]'::jsonb,
      true
    )
    ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name,
        email_verified = EXCLUDED.email_verified,
        updated_at = NOW(),
        organisation_id = EXCLUDED.organisation_id,
        role = EXCLUDED.role,
        roles = EXCLUDED.roles,
        is_active = EXCLUDED.is_active
  `

  await sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      created_at,
      updated_at,
      organisation_id,
      role,
      roles,
      is_active
    )
    VALUES (
      ${createId()},
      ${TEST_PASSWORD_MANAGER_MEMBER.name},
      ${TEST_PASSWORD_MANAGER_MEMBER.email},
      true,
      NOW(),
      NOW(),
      (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
      'member',
      '[]'::jsonb,
      true
    )
    ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name,
        email_verified = EXCLUDED.email_verified,
        updated_at = NOW(),
        organisation_id = EXCLUDED.organisation_id,
        role = EXCLUDED.role,
        roles = EXCLUDED.roles,
        is_active = EXCLUDED.is_active,
        deleted_at = NULL
  `

  await sql`
    INSERT INTO account (
      id,
      account_id,
      provider_id,
      user_id,
      password,
      created_at,
      updated_at
    )
    VALUES (
      ${createId()},
      (SELECT id FROM "user" WHERE email = ${TEST_USER.email}),
      'credential',
      (SELECT id FROM "user" WHERE email = ${TEST_USER.email}),
      ${passwordHash},
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `

  await sql`
    DELETE FROM account
    WHERE user_id = (SELECT id FROM "user" WHERE email = ${TEST_USER.email})
      AND provider_id = 'credential'
      AND id NOT IN (
        SELECT id
        FROM account
        WHERE user_id = (SELECT id FROM "user" WHERE email = ${TEST_USER.email})
          AND provider_id = 'credential'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      )
  `

  await sql`DELETE FROM "session" WHERE user_id = (SELECT id FROM "user" WHERE email = ${TEST_USER.email})`
}
