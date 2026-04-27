import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('authenticated user can search and filter the host inventory', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  const orgRows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(orgRows).toHaveLength(1)
  const orgId = orgRows[0]!.id

  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status,
      cpu_percent,
      memory_percent,
      disk_percent,
      last_seen_at
    )
    VALUES
      (
        'host-alpha',
        ${orgId},
        'alpha-node',
        'Alpha Node',
        'Ubuntu 24.04',
        'x86_64',
        '["10.0.0.10"]'::jsonb,
        'online',
        15,
        20,
        25,
        NOW()
      ),
      (
        'host-beta',
        ${orgId},
        'beta-node',
        'Beta Node',
        'Windows 11',
        'x86_64',
        '["10.0.0.20"]'::jsonb,
        'offline',
        35,
        40,
        45,
        NOW() - INTERVAL '2 hours'
      )
  `

  await page.goto('/hosts')

  await expect(page.getByTestId('hosts-heading')).toBeVisible()
  await expect(page.getByText('2 hosts registered')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()

  await page.getByTestId('hosts-search-input').fill('10.0.0.20')
  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toHaveCount(0)
  await expect(page.getByTestId('hosts-clear-filters')).toBeVisible()

  await page.getByTestId('hosts-clear-filters').click()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()

  await page.getByTestId('hosts-status-filter').click()
  await page.getByRole('option', { name: 'Offline' }).click()

  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toHaveCount(0)

  await page.getByTestId('hosts-os-filter').click()
  await page.getByRole('option', { name: 'Windows 11' }).click()

  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()
  await expect(page.getByText('Showing 1–1 of 1')).toBeVisible()
})
