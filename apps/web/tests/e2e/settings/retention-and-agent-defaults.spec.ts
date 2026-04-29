import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('admin can update metric retention from monitoring settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await page.goto('/settings/monitoring/retention')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  await page.getByTestId('settings-retention-select').click()
  await page.getByRole('option', { name: '14 days' }).click()
  await page.getByTestId('settings-retention-save').click()
  await expect(page.getByTestId('settings-retention-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ metric_retention_days: number }>>`
        SELECT metric_retention_days
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return rows[0]?.metric_retention_days ?? null
    })
    .toBe(14)
})

test('admin can update default host collection settings from agent defaults', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await page.goto('/settings/agents/defaults')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  await page.getByTestId('settings-collection-cpu-toggle').click()
  await page.getByTestId('settings-collection-local-users-toggle').click()
  await page.getByTestId('settings-collection-save').click()
  await expect(page.getByTestId('settings-collection-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        metadata: {
          defaultCollectionSettings?: {
            cpu?: boolean
            memory?: boolean
            disk?: boolean
            localUsers?: boolean
          }
        } | null
      }>>`
        SELECT metadata
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return rows[0]?.metadata?.defaultCollectionSettings ?? null
    })
    .toEqual({
      cpu: false,
      memory: true,
      disk: true,
      localUsers: true,
    })
})

test('admin can update software inventory defaults from agent settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await page.goto('/settings/agents/software')
  await expect(page.getByTestId('settings-heading')).toBeVisible()

  await page.getByTestId('settings-software-enabled-toggle').click()
  await page.getByTestId('settings-software-interval-input').fill('48')
  await page.getByTestId('settings-software-snap-toggle').click()
  await page.getByTestId('settings-software-windows-store-toggle').click()
  await page.getByTestId('settings-software-save').click()
  await expect(page.getByTestId('settings-software-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        metadata: {
          softwareInventorySettings?: {
            enabled?: boolean
            intervalHours?: number
            includeSnapFlatpak?: boolean
            includeWindowsStore?: boolean
          }
        } | null
      }>>`
        SELECT metadata
        FROM organisations
        WHERE slug = ${TEST_ORG.slug}
        LIMIT 1
      `

      return rows[0]?.metadata?.softwareInventorySettings ?? null
    })
    .toEqual({
      enabled: true,
      intervalHours: 48,
      includeSnapFlatpak: true,
      includeWindowsStore: true,
    })
})
