import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER } from '../fixtures/seed'

async function getUserId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ user_id: string }>>`
    SELECT id AS user_id
    FROM "user"
    WHERE email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.user_id
}

test('read-only users cannot access tooling pages or certificate checker API', async ({ authenticatedPage: page, baseURL }) => {
  const sql = getTestDb()
  const userId = await getUserId(sql)

  await sql`UPDATE "user" SET role = 'read_only', updated_at = NOW() WHERE id = ${userId}`

  try {
    await page.goto('/dashboard')
    await expect(page.getByText('Tooling')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'SSL Certificate Checker' })).toHaveCount(0)

    for (const path of ['/certificate-checker', '/directory-lookup', '/tasks', '/build-docs']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/dashboard$/)
    }

    const response = await page.request.post(`${baseURL}/api/tools/certificate-checker`, {
      headers: {
        origin: baseURL!,
      },
      data: {
        action: 'parse',
        pemText: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      },
    })
    expect(response.status()).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'Forbidden' })
  } finally {
    await sql`UPDATE "user" SET role = 'org_admin', updated_at = NOW() WHERE id = ${userId}`
  }
})
