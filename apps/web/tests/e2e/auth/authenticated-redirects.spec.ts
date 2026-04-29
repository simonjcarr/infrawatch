import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER } from '../fixtures/seed'

test('authenticated user visiting login is redirected to the dashboard', async ({ authenticatedPage: page }) => {
  await page.goto('/login')

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
})

test('pending users are redirected to approval and can sign out', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const rows = await sql`
    SELECT id AS user_id
    FROM "user"
    WHERE email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  const userId = rows[0]?.user_id
  expect(userId).toBeTruthy()

  await sql`UPDATE "user" SET role = 'pending', updated_at = NOW() WHERE id = ${userId}`

  try {
    await page.goto('/dashboard')

    await page.waitForURL('**/pending-approval')
    await expect(page.getByTestId('pending-approval-card')).toBeVisible()
    await expect(page.getByTestId('pending-approval-heading')).toContainText('Account pending approval')
    await expect(page.getByText('needs to be approved by an administrator.')).toBeVisible()

    await page.getByTestId('pending-approval-signout').click()
    await page.waitForURL('**/login')
    await expect(page.getByTestId('login-submit')).toBeVisible()
  } finally {
    await sql`UPDATE "user" SET role = 'org_admin', updated_at = NOW() WHERE id = ${userId}`
  }
})
