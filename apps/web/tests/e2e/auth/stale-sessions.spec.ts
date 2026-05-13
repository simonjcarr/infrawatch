import { createId } from '@paralleldrive/cuid2'
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'
import { createStorageStateForUser } from '../fixtures/auth'

async function getInstanceId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

async function createInstanceUser(
  sql: ReturnType<typeof getTestDb>,
  instanceId: string,
  input: { email: string; isActive?: boolean; deleted?: boolean },
): Promise<string> {
  const userId = createId()

  await sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      instance_id,
      role,
      is_active,
      deleted_at
    )
    VALUES (
      ${userId},
      ${input.email},
      ${input.email},
      true,
      ${instanceId},
      'engineer',
      ${input.isActive ?? true},
      ${input.deleted ? new Date() : null}
    )
  `

  return userId
}

async function getSessionCount(
  sql: ReturnType<typeof getTestDb>,
  userId: string,
): Promise<number> {
  const rows = await sql<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM "session"
    WHERE user_id = ${userId}
  `
  return rows[0]?.count ?? 0
}

test('deactivating a user revokes existing sessions and blocks stale dashboard/api access', async ({
  authenticatedPage: adminPage,
  browser,
  baseURL,
}) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const userId = await createInstanceUser(sql, instanceId, {
    email: 'stale-deactivated@example.com',
  })

  const storageState = await createStorageStateForUser(baseURL!, userId)
  const staleContext = await browser.newContext({ storageState })
  const stalePage = await staleContext.newPage()

  try {
    await stalePage.goto('/dashboard')
    await expect(stalePage.getByTestId('dashboard-heading')).toBeVisible()

    await adminPage.goto('/team')
    const row = adminPage.locator('tr').filter({ hasText: 'stale-deactivated@example.com' })
    await expect(row).toContainText('Active')
    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect(row).toContainText('Inactive')

    await expect.poll(async () => getSessionCount(sql, userId)).toBe(0)

    const response = await stalePage.request.get('/api/overview')
    expect(response.status()).toBe(401)

    await stalePage.goto('/dashboard')
    await expect(stalePage).toHaveURL(/\/login(?:\?session=expired)?$/)
  } finally {
    await staleContext.close()
  }
})

test('removing a user clears any leftover sessions', async ({
  authenticatedPage: adminPage,
  browser,
  baseURL,
}) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const userId = await createInstanceUser(sql, instanceId, {
    email: 'stale-removed@example.com',
    isActive: false,
  })

  const storageState = await createStorageStateForUser(baseURL!, userId)
  const staleContext = await browser.newContext({ storageState })

  try {
    await expect.poll(async () => getSessionCount(sql, userId)).toBe(1)

    await adminPage.goto('/team')
    const row = adminPage.locator('tr').filter({ hasText: 'stale-removed@example.com' })
    await expect(row).toContainText('Inactive')
    await row.getByRole('button', { name: 'Remove' }).click()

    await expect.poll(async () => getSessionCount(sql, userId)).toBe(0)
    await expect
      .poll(async () => {
        const rows = await sql<Array<{ deleted: boolean }>>`
          SELECT deleted_at IS NOT NULL AS deleted
          FROM "user"
          WHERE id = ${userId}
        `
        return rows[0]?.deleted ?? false
      })
      .toBe(true)
  } finally {
    await staleContext.close()
  }
})
