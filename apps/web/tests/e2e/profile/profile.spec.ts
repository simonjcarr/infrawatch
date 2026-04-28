import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER } from '../fixtures/seed'

test('authenticated user can update their display name from profile', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const updatedName = `Updated ${Date.now()}`

  await page.goto('/profile')

  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  const nameInput = page.getByLabel('Full name')
  await nameInput.click()
  await nameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await nameInput.fill(updatedName)
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Saved')).toBeVisible()
  await expect(nameInput).toHaveValue(updatedName)

  const rows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM "user"
    WHERE email = ${TEST_USER.email}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe(updatedName)
})
