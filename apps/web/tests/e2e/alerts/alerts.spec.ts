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

test('admin can review, filter, acknowledge, and clean up alert settings', async ({ authenticatedPage: page }) => {
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
      ip_addresses,
      status
    )
    VALUES
      (
        'alert-host-critical',
        ${orgId},
        'db-primary',
        'DB Primary',
        'Ubuntu 24.04',
        'x86_64',
        '["10.10.0.10"]'::jsonb,
        'online'
      ),
      (
        'alert-host-warning',
        ${orgId},
        'web-edge',
        'Web Edge',
        'Ubuntu 24.04',
        'x86_64',
        '["10.10.0.11"]'::jsonb,
        'online'
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
    VALUES
      (
        'alert-rule-critical',
        ${orgId},
        'alert-host-critical',
        'High CPU',
        'metric_threshold',
        '{"metric":"cpu","operator":"gt","threshold":90}'::jsonb,
        'critical'
      ),
      (
        'alert-rule-warning',
        ${orgId},
        'alert-host-warning',
        'Disk Filling',
        'metric_threshold',
        '{"metric":"disk","operator":"gt","threshold":80}'::jsonb,
        'warning'
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
        'alert-instance-critical',
        'alert-rule-critical',
        'alert-host-critical',
        ${orgId},
        'firing',
        'CPU usage exceeded 95%',
        NOW() - INTERVAL '6 minutes'
      ),
      (
        'alert-instance-warning',
        'alert-rule-warning',
        'alert-host-warning',
        ${orgId},
        'firing',
        'Disk usage exceeded 82%',
        NOW() - INTERVAL '3 minutes'
      ),
      (
        'alert-instance-history',
        'alert-rule-warning',
        'alert-host-warning',
        ${orgId},
        'resolved',
        'Disk usage returned to normal',
        NOW() - INTERVAL '2 days'
      )
  `

  await sql`
    UPDATE alert_instances
    SET resolved_at = NOW() - INTERVAL '2 days' + INTERVAL '30 minutes'
    WHERE id = 'alert-instance-history'
  `

  await sql`
    INSERT INTO alert_silences (
      id,
      organisation_id,
      host_id,
      reason,
      starts_at,
      ends_at,
      created_by
    )
    VALUES (
      'alert-silence-maintenance',
      ${orgId},
      'alert-host-critical',
      'Maintenance window',
      NOW() - INTERVAL '15 minutes',
      NOW() + INTERVAL '45 minutes',
      ${userId}
    )
  `

  await sql`
    INSERT INTO notification_channels (
      id,
      organisation_id,
      name,
      type,
      config
    )
    VALUES (
      'alert-channel-email',
      ${orgId},
      'Primary Email',
      'smtp',
      '{"toAddresses":["alerts@example.com","ops@example.com"]}'::jsonb
    )
  `

  await page.goto('/alerts')

  await expect(page.getByTestId('alerts-heading')).toBeVisible()
  await expect(page.getByTestId('alert-row-alert-instance-critical')).toContainText('High CPU')
  await expect(page.getByTestId('alert-row-alert-instance-warning')).toContainText('Disk Filling')
  await expect(page.getByTestId('alert-history-row-alert-instance-history')).toContainText('Resolved')
  await expect(page.getByTestId('alert-silence-row-alert-silence-maintenance')).toContainText('Maintenance window')
  await expect(page.getByTestId('alert-channel-row-alert-channel-email')).toContainText('alerts@example.com')

  await page.getByTestId('alerts-severity-filter').click()
  await page.getByRole('option', { name: 'Critical' }).click()

  await expect(page.getByTestId('alert-row-alert-instance-critical')).toBeVisible()
  await expect(page.getByTestId('alert-row-alert-instance-warning')).toHaveCount(0)

  await page.getByTestId('alert-acknowledge-alert-instance-critical').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ status: string; acknowledged_at: Date | null; acknowledged_by: string | null }>>`
        SELECT status, acknowledged_at, acknowledged_by
        FROM alert_instances
        WHERE id = 'alert-instance-critical'
        LIMIT 1
      `

      return rows[0] ?? null
    })
    .toMatchObject({
      status: 'acknowledged',
      acknowledged_at: expect.any(Date),
      acknowledged_by: userId,
    })

  await expect(page.getByTestId('alert-row-alert-instance-critical')).toHaveCount(0)
  await expect(page.getByTestId('alert-history-row-alert-instance-critical')).toContainText('Acknowledged')

  await page.getByTestId('alerts-delete-silence-alert-silence-maintenance').click()
  await expect(page.getByTestId('alert-silence-row-alert-silence-maintenance')).toHaveCount(0)

  await page.getByTestId('alerts-delete-channel-alert-channel-email').click()
  await expect(page.getByTestId('alert-channel-row-alert-channel-email')).toHaveCount(0)

  const cleanupRows = await sql<Array<{ silence_deleted: Date | null; channel_deleted: Date | null }>>`
    SELECT
      (SELECT deleted_at FROM alert_silences WHERE id = 'alert-silence-maintenance') AS silence_deleted,
      (SELECT deleted_at FROM notification_channels WHERE id = 'alert-channel-email') AS channel_deleted
  `

  expect(cleanupRows).toEqual([
    {
      silence_deleted: expect.any(Date),
      channel_deleted: expect.any(Date),
    },
  ])
})
