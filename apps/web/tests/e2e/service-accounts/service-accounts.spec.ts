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
      ),
      (
        'svc-account-locked',
        ${orgId},
        'svc-locked',
        'Locked Service',
        'svc-locked@example.com',
        'locked'
      ),
      (
        'svc-account-expired',
        ${orgId},
        'svc-expired',
        'Expired Service',
        'svc-expired@example.com',
        'expired'
      )
  `

  await page.goto('/service-accounts')

  await expect(page.getByTestId('service-accounts-heading')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toContainText('svc-active')
  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toContainText('svc-disabled')
  await expect(page.getByTestId('service-account-row-svc-account-locked')).toContainText('svc-locked')
  await expect(page.getByTestId('service-account-row-svc-account-expired')).toContainText('svc-expired')
  await expect(page.getByText('4 service accounts tracked')).toBeVisible()

  await page.getByTestId('service-accounts-summary-locked').click()
  await expect(page.getByTestId('service-account-row-svc-account-locked')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toHaveCount(0)
  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toHaveCount(0)
  await expect(page.getByTestId('service-account-row-svc-account-expired')).toHaveCount(0)

  await page.getByTestId('service-accounts-summary-expired').click()
  await expect(page.getByTestId('service-account-row-svc-account-expired')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toHaveCount(0)
  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toHaveCount(0)
  await expect(page.getByTestId('service-account-row-svc-account-locked')).toHaveCount(0)

  await page.getByTestId('service-accounts-summary-total').click()
  await expect(page.getByTestId('service-account-row-svc-account-active')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-disabled')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-locked')).toBeVisible()
  await expect(page.getByTestId('service-account-row-svc-account-expired')).toBeVisible()

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
  await expect(page.getByText('5 service accounts tracked')).toBeVisible()

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

test('admin can update and delete a service account from the detail page', async ({ authenticatedPage: page }) => {
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
      status,
      password_expires_at
    )
    VALUES (
      'svc-account-detail',
      ${orgId},
      'svc-detail',
      'Ops Service',
      'ops-service@example.com',
      'active',
      DATE '2026-05-01'
    )
  `

  await page.goto('/service-accounts')
  await page.getByTestId('service-account-row-svc-account-detail').click()

  await expect(page).toHaveURL(/\/service-accounts\/svc-account-detail$/)
  await expect(page.getByTestId('service-account-detail-heading')).toContainText('svc-detail')
  await expect(page.getByText('Ops Service')).toBeVisible()

  await page.getByTestId('service-account-edit-open').click()
  await page.getByTestId('service-account-edit-display-name').fill('Ops Service Updated')
  await page.getByTestId('service-account-edit-email').fill('ops-updated@example.com')
  await page.getByTestId('service-account-edit-status').click()
  await page.getByRole('option', { name: 'Disabled' }).click()
  await page.getByTestId('service-account-edit-password-expiry').fill('2026-06-15')
  await page.getByTestId('service-account-edit-save').click()

  await expect(page.getByText('Ops Service Updated')).toBeVisible()
  await expect(page.getByText('ops-updated@example.com')).toBeVisible()
  await expect(page.getByTestId('service-account-detail-status')).toContainText('Disabled')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        display_name: string | null
        email: string | null
        status: string
        password_expires_at: string | null
      }>>`
        SELECT
          display_name,
          email,
          status,
          password_expires_at::text
        FROM domain_accounts
        WHERE id = 'svc-account-detail'
        LIMIT 1
      `

      return rows[0] ?? null
    })
    .toEqual({
      display_name: 'Ops Service Updated',
      email: 'ops-updated@example.com',
      status: 'disabled',
      password_expires_at: '2026-06-15 00:00:00+00',
    })

  await page.getByTestId('service-account-delete-open').click()
  await page.getByTestId('service-account-delete-confirm').click()

  await expect(page).toHaveURL(/\/service-accounts$/)
  await expect(page.getByTestId('service-account-row-svc-account-detail')).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM domain_accounts
        WHERE id = 'svc-account-detail'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .toBeTruthy()
})
