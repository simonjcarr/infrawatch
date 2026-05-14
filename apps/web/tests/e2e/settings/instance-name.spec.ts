import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'

test('admin can update the instance name from settings', async ({ authenticatedPage: page }) => {
  const updatedName = `Updated Instance ${Date.now()}`
  const sql = getTestDb()

  await page.goto('/settings')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  const instanceNameInput = page.getByTestId('settings-instance-name-input')
  await instanceNameInput.click()
  await instanceNameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await instanceNameInput.fill('A')
  await page.getByTestId('settings-instance-name-save').click()

  await expect(page.getByText('Name must be at least 2 characters')).toBeVisible()

  const beforeRows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `

  expect(beforeRows).toHaveLength(1)
  expect(beforeRows[0]?.name).toBe(TEST_INSTANCE.name)

  await instanceNameInput.click()
  await instanceNameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await instanceNameInput.fill(updatedName)
  await page.getByTestId('settings-instance-name-save').click()

  await expect(page.getByTestId('settings-instance-name-success')).toHaveText('Saved')
  await expect(instanceNameInput).toHaveValue(updatedName)

  const rows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe(updatedName)
})

test('instance name validation rejects names shorter than two characters', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await sql`
    UPDATE instance_settings
    SET name = ${TEST_INSTANCE.name}
    WHERE slug = ${TEST_INSTANCE.slug}
  `

  await page.goto('/settings')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  const instanceNameInput = page.getByTestId('settings-instance-name-input')
  await instanceNameInput.click()
  await instanceNameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await instanceNameInput.fill('A')
  await page.getByTestId('settings-instance-name-save').click()

  await expect(page.getByText('Name must be at least 2 characters')).toBeVisible()
  await expect(page.getByTestId('settings-instance-name-success')).toHaveCount(0)

  const rows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe(TEST_INSTANCE.name)
})
