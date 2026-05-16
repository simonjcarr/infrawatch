import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'

async function getInstanceId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

async function seedHostsAndAlerts(sql: ReturnType<typeof getTestDb>, instanceId: string) {
  await sql`
    INSERT INTO hosts (
      id,
      instance_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status
    )
    VALUES
      (
        'metric-default-host-a',
        ${instanceId},
        'metric-default-a',
        'Metric Default A',
        'Ubuntu 24.04',
        'x86_64',
        '["10.20.0.10"]'::jsonb,
        'online'
      ),
      (
        'metric-default-host-b',
        ${instanceId},
        'metric-default-b',
        'Metric Default B',
        'Ubuntu 24.04',
        'x86_64',
        '["10.20.0.11"]'::jsonb,
        'online'
      )
  `

  await sql`
    INSERT INTO alert_rules (
      id,
      instance_id,
      host_id,
      name,
      condition_type,
      config,
      severity,
      is_global_default
    )
    VALUES
      (
        'metric-default-global-cpu',
        ${instanceId},
        NULL,
        'Default CPU',
        'metric_threshold',
        '{"metric":"cpu","operator":"gt","threshold":82}'::jsonb,
        'warning',
        true
      ),
      (
        'metric-default-global-memory',
        ${instanceId},
        NULL,
        'Default Memory',
        'metric_threshold',
        '{"metric":"memory","operator":"gt","threshold":88}'::jsonb,
        'critical',
        true
      ),
      (
        'metric-default-host-a-old-metric',
        ${instanceId},
        'metric-default-host-a',
        'Old Host A CPU',
        'metric_threshold',
        '{"metric":"cpu","operator":"gt","threshold":95}'::jsonb,
        'critical',
        false
      ),
      (
        'metric-default-host-a-check',
        ${instanceId},
        'metric-default-host-a',
        'Host A Check',
        'check_status',
        '{"checkId":"check-a","failureThreshold":3}'::jsonb,
        'warning',
        false
      ),
      (
        'metric-default-host-b-old-metric',
        ${instanceId},
        'metric-default-host-b',
        'Old Host B Disk',
        'metric_threshold',
        '{"metric":"disk","operator":"gt","threshold":91}'::jsonb,
        'warning',
        false
      ),
      (
        'metric-default-host-b-docker',
        ${instanceId},
        'metric-default-host-b',
        'Host B Docker',
        'docker_container',
        '{"rule":"restart_loop","windowMinutes":10,"threshold":3,"sampleThreshold":3}'::jsonb,
        'warning',
        false
      )
  `
}

test('admin can replace one host metric alerts with global metric defaults', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  await seedHostsAndAlerts(sql, instanceId)

  await page.goto('/hosts/metric-default-host-a')
  await page.getByTestId('host-parent-tab-monitoring').click()
  await page.getByTestId('host-tab-alerts').click()
  await expect(page.getByTestId('host-alert-rules-card')).toBeVisible()
  await expect(page.getByText('Old Host A CPU')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Default CPU')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('host-alerts-replace-metrics-with-defaults').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        active_a_defaults: number
        active_a_check: number
        deleted_a_old_metric: number
        active_b_old_metric: number
      }>>`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE instance_id = ${instanceId}
              AND host_id = 'metric-default-host-a'
              AND condition_type = 'metric_threshold'
              AND deleted_at IS NULL
              AND is_global_default = false
              AND name IN ('Default CPU', 'Default Memory')
          ) AS active_a_defaults,
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE id = 'metric-default-host-a-check'
              AND deleted_at IS NULL
          ) AS active_a_check,
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE id = 'metric-default-host-a-old-metric'
              AND deleted_at IS NOT NULL
          ) AS deleted_a_old_metric,
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE id = 'metric-default-host-b-old-metric'
              AND deleted_at IS NULL
          ) AS active_b_old_metric
      `

      return rows[0] ?? null
    }, { timeout: 30_000 })
    .toEqual({
      active_a_defaults: 2,
      active_a_check: 1,
      deleted_a_old_metric: 1,
      active_b_old_metric: 1,
    })
})

test('admin can replace all host metric alerts with global metric defaults', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  await seedHostsAndAlerts(sql, instanceId)

  await page.goto('/settings/monitoring')
  await expect(page.getByTestId('settings-alert-defaults-heading')).toBeVisible()
  await expect(page.getByText('Default CPU')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('settings-alert-defaults-replace-all-host-metrics').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        active_host_defaults: number
        deleted_old_metrics: number
        active_non_metric: number
        active_global_defaults: number
      }>>`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE instance_id = ${instanceId}
              AND host_id IN ('metric-default-host-a', 'metric-default-host-b')
              AND condition_type = 'metric_threshold'
              AND deleted_at IS NULL
              AND is_global_default = false
              AND name IN ('Default CPU', 'Default Memory')
          ) AS active_host_defaults,
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE id IN ('metric-default-host-a-old-metric', 'metric-default-host-b-old-metric')
              AND deleted_at IS NOT NULL
          ) AS deleted_old_metrics,
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE id IN ('metric-default-host-a-check', 'metric-default-host-b-docker')
              AND deleted_at IS NULL
          ) AS active_non_metric,
          (
            SELECT COUNT(*)::int
            FROM alert_rules
            WHERE id IN ('metric-default-global-cpu', 'metric-default-global-memory')
              AND deleted_at IS NULL
              AND is_global_default = true
          ) AS active_global_defaults
      `

      return rows[0] ?? null
    }, { timeout: 30_000 })
    .toEqual({
      active_host_defaults: 4,
      deleted_old_metrics: 2,
      active_non_metric: 2,
      active_global_defaults: 2,
    })
})
