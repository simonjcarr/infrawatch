import { expect, test } from '../fixtures/test'
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

test('admin can acknowledge alerts and manage webhook channels and silences', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      arch,
      status,
      last_seen_at
    )
    VALUES (
      'alerts-host-1',
      ${orgId},
      'alerts-host-1',
      'Alerts Host 1',
      'Ubuntu 24.04',
      'x86_64',
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
      severity
    )
    VALUES (
      'alerts-rule-1',
      ${orgId},
      'alerts-host-1',
      'CPU usage high',
      'metric_threshold',
      '{"metric":"cpu","operator":"gt","threshold":90}'::jsonb,
      'critical'
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
    VALUES (
      'alerts-instance-1',
      'alerts-rule-1',
      'alerts-host-1',
      ${orgId},
      'firing',
      'CPU exceeded 90% for more than five minutes.',
      NOW() - INTERVAL '10 minutes'
    )
  `

  await page.goto('/alerts')

  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
  await expect(page.getByText('1 active alert')).toBeVisible()

  const activeRow = page.getByRole('row', { name: /alerts-host-1.*CPU usage high/i })
  await expect(activeRow).toContainText('Critical')
  await activeRow.getByRole('button', { name: 'Acknowledge' }).click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ status: string; acknowledged_by: string | null }>>`
        SELECT status, acknowledged_by
        FROM alert_instances
        WHERE id = 'alerts-instance-1'
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      status: 'acknowledged',
      acknowledged_by: userId,
    })

  await expect(page.getByText('0 active alerts')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Acknowledged' })).toBeVisible()

  await page.getByRole('button', { name: 'Add Webhook' }).click()
  await page.getByLabel('Name').fill('PagerDuty Webhook')
  await page.getByLabel('URL').fill('https://alerts.example.test/webhook')
  await page.getByLabel(/Secret/i).fill('super-secret')
  await page.getByRole('button', { name: 'Add Channel' }).click()

  const webhookRow = page.getByRole('row', { name: /PagerDuty Webhook.*alerts\.example\.test\/webhook/i })
  await expect(webhookRow).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ name: string; type: string; config: { url?: string; secret?: string } }>>`
        SELECT name, type, config
        FROM notification_channels
        WHERE organisation_id = ${orgId}
          AND name = 'PagerDuty Webhook'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      name: 'PagerDuty Webhook',
      type: 'webhook',
      config: {
        url: 'https://alerts.example.test/webhook',
        secret: 'super-secret',
      },
    })

  await webhookRow.getByRole('button', { name: /edit channel/i }).click()
  await page.getByLabel('Name').fill('Ops Webhook')
  await page.getByLabel('URL').fill('https://alerts.example.test/ops')
  await page.getByRole('button', { name: 'Save Changes' }).click()

  const updatedWebhookRow = page.getByRole('row', { name: /Ops Webhook.*alerts\.example\.test\/ops/i })
  await expect(updatedWebhookRow).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ name: string; config: { url?: string; secret?: string } }>>`
        SELECT name, config
        FROM notification_channels
        WHERE organisation_id = ${orgId}
          AND name = 'Ops Webhook'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      name: 'Ops Webhook',
      config: {
        url: 'https://alerts.example.test/ops',
        secret: 'super-secret',
      },
    })

  await page.getByRole('button', { name: 'Add Silence' }).click()
  await page.getByLabel('Host').selectOption('alerts-host-1')
  await page.getByLabel('Reason').fill('Planned kernel maintenance')
  await page.getByLabel('Starts at').fill('2026-04-28T10:00')
  await page.getByLabel('Ends at').fill('2026-04-28T12:00')
  await page.getByRole('button', { name: 'Create Silence' }).click()

  const silenceRow = page.getByRole('row', { name: /alerts-host-1.*Planned kernel maintenance/i })
  await expect(silenceRow).toBeVisible()
  await expect(silenceRow).toContainText('Expired')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ reason: string; host_id: string | null }>>`
        SELECT reason, host_id
        FROM alert_silences
        WHERE organisation_id = ${orgId}
          AND reason = 'Planned kernel maintenance'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      reason: 'Planned kernel maintenance',
      host_id: 'alerts-host-1',
    })

  await silenceRow.getByRole('button', { name: /remove silence/i }).click()
  await expect(silenceRow).toHaveCount(0)

  await updatedWebhookRow.getByRole('button', { name: /delete channel/i }).click()
  await expect(updatedWebhookRow).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_channels: number; deleted_silences: number }>>`
        SELECT
          cast(count(*) FILTER (WHERE table_name = 'notification_channels') as int) AS deleted_channels,
          cast(count(*) FILTER (WHERE table_name = 'alert_silences') as int) AS deleted_silences
        FROM (
          SELECT 'notification_channels' AS table_name
          FROM notification_channels
          WHERE organisation_id = ${orgId}
            AND name = 'Ops Webhook'
            AND deleted_at IS NOT NULL
          UNION ALL
          SELECT 'alert_silences' AS table_name
          FROM alert_silences
          WHERE organisation_id = ${orgId}
            AND reason = 'Planned kernel maintenance'
            AND deleted_at IS NOT NULL
        ) deleted_rows
      `
      return rows[0] ?? null
    })
    .toEqual({
      deleted_channels: 1,
      deleted_silences: 1,
    })
})
