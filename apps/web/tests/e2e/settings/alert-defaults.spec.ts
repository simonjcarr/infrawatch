import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('admin can create and delete global alert defaults from monitoring settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await page.goto('/settings/monitoring')
  await expect(page.getByTestId('settings-alert-defaults-heading')).toBeVisible()
  await expect(page.getByTestId('settings-alert-defaults-empty')).toBeVisible()

  await page.getByTestId('settings-alert-defaults-add').click()
  await page.getByTestId('settings-alert-default-name').fill('Memory saturation')
  await page.getByTestId('settings-alert-default-metric').click()
  await page.getByRole('option', { name: 'Memory' }).click()
  await page.getByTestId('settings-alert-default-threshold').fill('85')
  await page.getByTestId('settings-alert-default-severity').click()
  await page.getByRole('option', { name: 'Critical' }).click()
  await page.getByTestId('settings-alert-default-submit').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        id: string
        name: string
        severity: string
        condition_type: string
        config: { metric?: string; operator?: string; threshold?: number } | null
      }>>`
        SELECT id, name, severity, condition_type, config
        FROM alert_rules
        WHERE organisation_id = (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug})
          AND host_id IS NULL
          AND is_global_default = true
          AND deleted_at IS NULL
          AND name = 'Memory saturation'
        LIMIT 1
      `

      return rows[0] ?? null
    })
    .toMatchObject({
      id: expect.any(String),
      name: 'Memory saturation',
      severity: 'critical',
      condition_type: 'metric_threshold',
      config: {
        metric: 'memory',
        operator: 'gt',
        threshold: 85,
      },
    })

  const createdRows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM alert_rules
    WHERE organisation_id = (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug})
      AND host_id IS NULL
      AND is_global_default = true
      AND deleted_at IS NULL
      AND name = 'Memory saturation'
    LIMIT 1
  `
  const createdRuleId = createdRows[0]!.id

  const row = page.getByTestId(`settings-alert-default-row-${createdRuleId}`)
  await expect(row).toContainText('Memory saturation')
  await expect(row).toContainText('MEMORY > 85%')
  await expect(row).toContainText('Critical')

  await page.getByTestId(`settings-alert-default-delete-${createdRuleId}`).click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM alert_rules
        WHERE id = ${createdRuleId}
        LIMIT 1
      `

      return rows[0]?.deleted_at ?? null
    })
    .toEqual(expect.any(Date))

  await expect(page.getByTestId(`settings-alert-default-row-${createdRuleId}`)).toHaveCount(0)
})
