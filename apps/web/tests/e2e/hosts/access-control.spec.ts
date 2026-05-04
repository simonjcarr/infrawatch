import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG, TEST_USER } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ orgId: string; userId: string }> {
  const rows = await sql<Array<{ org_id: string; user_id: string }>>`
    SELECT organisations.id AS org_id, "user".id AS user_id
    FROM organisations
    JOIN "user" ON "user".organisation_id = organisations.id
    WHERE organisations.slug = ${TEST_ORG.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    orgId: rows[0]!.org_id,
    userId: rows[0]!.user_id,
  }
}

test('read-only users cannot delete hosts from the host detail page', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status,
      last_seen_at
    )
    VALUES (
      'read-only-host-1',
      ${orgId},
      'readonly-node',
      'Read Only Node',
      'Ubuntu 24.04',
      'x86_64',
      '["10.80.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await sql`UPDATE "user" SET role = 'read_only', updated_at = NOW() WHERE id = ${userId}`

  try {
    await page.goto('/hosts/read-only-host-1')
    await expect(page.getByText('Read Only Node')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete Host' })).toHaveCount(0)

    await expect
      .poll(async () => {
        const rows = await sql<Array<{ deleted_at: string | null }>>`
          SELECT deleted_at
          FROM hosts
          WHERE id = 'read-only-host-1'
            AND organisation_id = ${orgId}
          LIMIT 1
        `
        return rows[0]?.deleted_at ?? 'present'
      })
      .toBe('present')
  } finally {
    await sql`UPDATE "user" SET role = 'org_admin', updated_at = NOW() WHERE id = ${userId}`
  }
})
