import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG, TEST_USER } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ orgId: string; userId: string }> {
  const rows = await sql<Array<{ org_id: string; user_id: string }>>`
    SELECT organisations.id AS org_id, "user".id AS user_id
    FROM organisations
    JOIN "user" ON "user".organisation_id = organisations.id
    WHERE organisations.slug = ${TEST_ORG.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    orgId: rows[0]!.org_id,
    userId: rows[0]!.user_id,
  }
}

test('admin can filter, acknowledge, and configure alerting from the alerts page', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId } = await getOrgAndUserIds(sql)

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
      last_seen_at
    )
    VALUES
      (
        'alerts-host-critical',
        ${orgId},
        'alerts-host-critical',
        'Alerts Host Critical',
        'Ubuntu 24.04',
        'x86_64',
        '["10.70.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'alerts-host-warning',
        ${orgId},
        'alerts-host-warning',
        'Alerts Host Warning',
        'Ubuntu 24.04',
        'x86_64',
        '["10.70.0.11"]'::jsonb,
        'online',
        NOW()
      )
  `

  await sql`
    INSERT INTO alert_rules (
      id,
      organisation_id,
      host_id,
      name,
      condition_type,
      config,
      severity,
      enabled,
      is_global_default
    )
    VALUES
      (
        'alerts-rule-critical',
        ${orgId},
        'alerts-host-critical',
        'CPU saturation',
        'metric_threshold',
        '{"metric":"cpu","operator":"gt","threshold":95}'::jsonb,
        'critical',
        true,
        false
      ),
      (
        'alerts-rule-warning',
        ${orgId},
        'alerts-host-warning',
        'Disk usage warning',
        'metric_threshold',
        '{"metric":"disk","operator":"gt","threshold":80}'::jsonb,
        'warning',
        true,
        false
      )
  `

  await sql`
    INSERT INTO alert_instances (
      id,
      rule_id,
      host_id,
      organisation_id,
      status,
      message,
      triggered_at
    )
    VALUES
      (
        'alerts-instance-critical',
        'alerts-rule-critical',
        'alerts-host-critical',
        ${orgId},
        'firing',
        'CPU has exceeded 95% for 10 minutes',
        NOW() - INTERVAL '10 minutes'
      ),
      (
        'alerts-instance-warning',
        'alerts-rule-warning',
        'alerts-host-warning',
        ${orgId},
        'firing',
        'Disk usage has exceeded 80%',
        NOW() - INTERVAL '5 minutes'
      )
  `

  await page.goto('/alerts')

  await expect(page.getByTestId('alerts-heading')).toBeVisible()
  await expect(page.getByTestId('alert-row-alerts-instance-critical')).toContainText('alerts-host-critical')
  await expect(page.getByTestId('alert-row-alerts-instance-warning')).toContainText('alerts-host-warning')

  await page.getByTestId('alerts-severity-filter').click()
  await page.getByRole('option', { name: 'Critical' }).click()

  await expect(page.getByTestId('alert-row-alerts-instance-critical')).toBeVisible()
  await expect(page.getByTestId('alert-row-alerts-instance-warning')).toHaveCount(0)

  await page.getByTestId('alert-acknowledge-alerts-instance-critical').click()

  await expect(page.getByTestId('alert-row-alerts-instance-critical')).toHaveCount(0)
  await expect(page.getByTestId('alert-history-row-alerts-instance-critical')).toContainText('Acknowledged')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ status: string; acknowledged_at: string | null }>>`
        SELECT status, acknowledged_at::text
        FROM alert_instances
        WHERE id = 'alerts-instance-critical'
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      status: 'acknowledged',
      acknowledged_at: expect.any(String),
    })

  await page.getByTestId('alerts-add-silence').click()
  await page.getByLabel('Host (leave blank for org-wide)').selectOption('alerts-host-warning')
  await page.getByLabel('Reason').fill('Scheduled maintenance')
  await page.getByTestId('alert-silence-submit').click()

  await expect(page.getByTestId('alert-silence-row')).toContainText('alerts-host-warning')
  await expect(page.getByTestId('alert-silence-row')).toContainText('Scheduled maintenance')

  await page.getByTestId('alerts-add-email').click()
  await page.getByLabel('Name').fill('Ops Email')
  await page.getByLabel('Recipients').fill('ops@example.com, team@example.com')
  await page.getByTestId('alert-email-submit').click()

  const emailRow = page.getByTestId('alert-channel-row').filter({ hasText: 'Ops Email' })
  await expect(emailRow).toContainText('ops@example.com, team@example.com')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ name: string; type: string; config: { toAddresses: string[] } }>>`
        SELECT name, type, config
        FROM notification_channels
        WHERE organisation_id = ${orgId}
          AND name = 'Ops Email'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      name: 'Ops Email',
      type: 'smtp',
      config: {
        toAddresses: ['ops@example.com', 'team@example.com'],
      },
    })
})
