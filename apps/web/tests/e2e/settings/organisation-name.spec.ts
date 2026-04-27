import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('admin can update the organisation name from settings', async ({ authenticatedPage: page }) => {
  const updatedName = `Updated Org ${Date.now()}`

  await page.goto('/settings')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  const orgNameInput = page.getByTestId('settings-org-name-input')
  await orgNameInput.click()
  await orgNameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await orgNameInput.fill(updatedName)
  await page.getByTestId('settings-org-name-save').click()

  await expect(page.getByTestId('settings-org-name-success')).toHaveText('Saved')
  await expect(orgNameInput).toHaveValue(updatedName)

  const sql = getTestDb()
  const rows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe(updatedName)
})

test('organisation name validation rejects names shorter than two characters', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await sql`
    UPDATE organisations
    SET name = ${TEST_ORG.name}
    WHERE slug = ${TEST_ORG.slug}
  `

  await page.goto('/settings')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  const orgNameInput = page.getByTestId('settings-org-name-input')
  await orgNameInput.click()
  await orgNameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await orgNameInput.fill('A')
  await page.getByTestId('settings-org-name-save').click()

  await expect(page.getByText('Name must be at least 2 characters')).toBeVisible()
  await expect(page.getByTestId('settings-org-name-success')).toHaveCount(0)

  const rows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe(TEST_ORG.name)
})
