import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG, TEST_USER } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ instanceId: string; userId: string }> {
  const rows = await sql<Array<{ instance_id: string; user_id: string }>>`
    SELECT instanceSettings.id AS instance_id, "user".id AS user_id
    FROM instance_settings
    JOIN "user" ON "user".instance_id = instanceSettings.id
    WHERE instanceSettings.slug = ${TEST_ORG.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    instanceId: rows[0]!.instance_id,
    userId: rows[0]!.user_id,
  }
}

test('read-only users cannot delete hosts from the host detail page', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO hosts (
      id,
      instance_id,
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
      ${instanceId},
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
            AND instance_id = ${instanceId}
          LIMIT 1
        `
        return rows[0]?.deleted_at ?? 'present'
      })
      .toBe('present')
  } finally {
    await sql`UPDATE "user" SET role = 'org_admin', updated_at = NOW() WHERE id = ${userId}`
  }
})
