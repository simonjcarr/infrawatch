import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM instance_settings
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('admin can set and clear a host Docker retention override', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getOrgId(sql)

  await sql`
    UPDATE instance_settings
    SET docker_metric_retention_days = 30
    WHERE id = ${instanceId}
  `

  await sql`
    INSERT INTO hosts (
      id,
      instance_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status,
      last_seen_at
    )
    VALUES (
      'docker-retention-host',
      ${instanceId},
      'docker-retention-node',
      'Docker Retention Node',
      'Linux',
      'x86_64',
      '["10.60.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await page.goto('/hosts/docker-retention-host')
  await page.getByTestId('host-parent-tab-management').click()
  await page.getByTestId('host-tab-settings').click()
  await expect(page.getByTestId('settings-docker-retention-inherited')).toContainText('30 days')

  await page.getByTestId('settings-docker-retention-override-select').click()
  await page.getByRole('option', { name: '90 days' }).click()
  await page.getByTestId('settings-docker-retention-save').click()
  await expect(page.getByTestId('settings-docker-retention-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ override: string | null }>>`
        SELECT metadata #>> '{dockerSettings,retentionDaysOverride}' AS override
        FROM hosts
        WHERE id = 'docker-retention-host'
        LIMIT 1
      `
      return rows[0]?.override ?? null
    })
    .toBe('90')

  await page.getByTestId('settings-docker-retention-clear').click()
  await expect(page.getByTestId('settings-docker-retention-success')).toHaveText('Saved')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ override_type: string | null }>>`
        SELECT jsonb_typeof(metadata #> '{dockerSettings,retentionDaysOverride}') AS override_type
        FROM hosts
        WHERE id = 'docker-retention-host'
        LIMIT 1
      `
      return rows[0]?.override_type ?? null
    })
    .toBe('null')
})
