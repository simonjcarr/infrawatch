import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'
import { issueTestLicence } from '../fixtures/licence'

async function getInstance(sql: ReturnType<typeof getTestDb>): Promise<{ id: string; licence_tier: string }> {
  const rows = await sql<Array<{ id: string; licence_tier: string }>>`
    SELECT id, licence_tier
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!
}

test('admin can validate and save a seat-capacity licence key from licence settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instance = await getInstance(sql)
  const licenceKey = await issueTestLicence({
    instanceId: instance.id,
    tier: 'community',
    maxUsers: 8,
  })

  await page.goto('/settings/licence')

  await expect(page.getByTestId('settings-heading')).toContainText('Instance')
  await expect(page.getByText('Current tier', { exact: true })).toBeVisible()
  await expect(page.getByText('Community', { exact: true })).toBeVisible()

  await page.getByLabel('Licence key').fill('not-a-real-licence')
  await page.getByRole('button', { name: 'Validate & save' }).click()
  await expect(page.getByText('Invalid licence key')).toBeVisible()

  await page.getByLabel('Licence key').fill(licenceKey)
  await page.getByRole('button', { name: 'Validate & save' }).click()

  await expect(page.getByText('Paid seats activated')).toContainText(
    'capacity increased from 3 to 8 user seats',
  )
  await expect(page.getByTestId('licence-seat-usage')).toContainText('/ 8')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ licence_tier: string; licence_key: string | null }>>`
        SELECT licence_tier, licence_key
        FROM instance_settings
        WHERE id = ${instance.id}
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      licence_tier: 'community',
      licence_key: licenceKey,
    })
})
