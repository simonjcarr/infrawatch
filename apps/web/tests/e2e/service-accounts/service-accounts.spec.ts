import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { issueTestLicence } from '../fixtures/licence'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('admin can review, filter, and add service accounts', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const licenceKey = await issueTestLicence({
    orgId,
    features: ['serviceAccountTracker'],
  })

  await sql`
    UPDATE organisations
    SET licence_key = ${licenceKey},
        licence_tier = 'pro'
    WHERE id = ${orgId}
  `

  await sql`
    INSERT INTO domain_accounts (
      id,
      organisation_id,
      username,
      display_name,
      email,
      status
    )
    VALUES
      (
        'svc-account-active',
        ${orgId},
        'svc-active',
        'Deploy Service',
        'svc-active@example.com',
        'active'
      ),
      (
        'svc-account-disabled',
        ${orgId},
        'svc-disabled',
        'Legacy Service',
        'svc-disabled@example.com',
        'disabled'
      )
  `

  await page.goto('/service-accounts')

  await expect(page.getByTestId('service-accounts-heading')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toContainText('svc-active')
  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toContainText('svc-disabled')

  await page.getByTestId('service-accounts-search-input').fill('Legacy Service')
  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toHaveCount(0)

  await page.getByTestId('service-accounts-search-input').fill('')
  await page.getByTestId('service-accounts-status-filter').click()
  await page.getByRole('option', { name: 'Disabled' }).click()

  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toHaveCount(0)

  await page.getByTestId('service-accounts-status-filter').click()
  await page.getByRole('option', { name: 'All statuses' }).click()
  await page.getByTestId('service-accounts-add-open').click()
  await page.getByTestId('service-accounts-add-username').fill('svc-reporting')
  await page.getByTestId('service-accounts-add-display-name').fill('Reporting Service')
  await page.getByTestId('service-accounts-add-email').fill('svc-reporting@example.com')
  await page.getByTestId('service-accounts-add-submit').click()

  const newRow = page.getByRole('row').filter({ hasText: 'svc-reporting' })
  await expect(newRow).toContainText('Reporting Service')
  await expect(page.getByText('3 service accounts tracked')).toBeVisible()

  const rows = await sql<Array<{ username: string; status: string; email: string | null }>>`
    SELECT username, status, email
    FROM domain_accounts
    WHERE organisation_id = ${orgId}
      AND username = 'svc-reporting'
      AND deleted_at IS NULL
    LIMIT 1
  `
  expect(rows).toEqual([
    {
      username: 'svc-reporting',
      status: 'active',
      email: 'svc-reporting@example.com',
    },
  ])
})
