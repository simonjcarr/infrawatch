import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'
import { issueTestLicence } from '../fixtures/licence'

async function getOrg(sql: ReturnType<typeof getTestDb>): Promise<{ id: string; licence_tier: string }> {
  const rows = await sql<Array<{ id: string; licence_tier: string }>>`
    SELECT id, licence_tier
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!
}

test('admin can validate and save a licence key from licence settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const org = await getOrg(sql)
  const licenceKey = await issueTestLicence({
    orgId: org.id,
    tier: 'enterprise',
    features: ['serviceAccountTracker'],
  })

  await page.goto('/settings/licence')

  await expect(page.getByTestId('settings-heading')).toContainText('Organisation')
  await expect(page.getByText('Current tier:')).toBeVisible()
  await expect(page.getByText('Community', { exact: true })).toBeVisible()

  await page.getByLabel('Licence key').fill('not-a-real-licence')
  await page.getByRole('button', { name: 'Validate & save' }).click()
  await expect(page.getByText('Invalid licence key')).toBeVisible()

  await page.getByLabel('Licence key').fill(licenceKey)
  await page.getByRole('button', { name: 'Validate & save' }).click()

  await expect(page.getByText('Licence activated')).toContainText('Enterprise')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ licence_tier: string; licence_key: string | null }>>`
        SELECT licence_tier, licence_key
        FROM organisations
        WHERE id = ${org.id}
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      licence_tier: 'enterprise',
      licence_key: licenceKey,
    })
})
