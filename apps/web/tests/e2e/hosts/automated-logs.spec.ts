import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
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

test('authenticated user can bulk delete automated host logs from the host detail page', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

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
    VALUES (
      'host-logs-e2e',
      ${orgId},
      'host-logs-node-1',
      'Automation Host',
      'Ubuntu 24.04',
      'x86_64',
      '["10.81.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await sql`
    INSERT INTO task_runs (
      id,
      organisation_id,
      triggered_by,
      target_type,
      target_id,
      task_type,
      config,
      max_parallel,
      status,
      started_at,
      completed_at
    )
    VALUES
      (
        'host-log-run-1',
        ${orgId},
        NULL,
        'host',
        'host-logs-e2e',
        'software_inventory',
        '{}'::jsonb,
        1,
        'completed',
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '170 minutes'
      ),
      (
        'host-log-run-2',
        ${orgId},
        NULL,
        'host',
        'host-logs-e2e',
        'software_inventory',
        '{}'::jsonb,
        1,
        'failed',
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '110 minutes'
      )
  `

  await sql`
    INSERT INTO task_run_hosts (
      id,
      organisation_id,
      task_run_id,
      host_id,
      status,
      result,
      started_at,
      completed_at
    )
    VALUES
      (
        'host-log-run-host-1',
        ${orgId},
        'host-log-run-1',
        'host-logs-e2e',
        'success',
        '{"package_count":52,"source":"apt"}'::jsonb,
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '170 minutes'
      ),
      (
        'host-log-run-host-2',
        ${orgId},
        'host-log-run-2',
        'host-logs-e2e',
        'failed',
        '{"package_count":0,"source":"apt"}'::jsonb,
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '110 minutes'
      )
  `

  await page.goto('/hosts/host-logs-e2e')

  await expect(page.getByRole('heading', { name: 'Automation Host' })).toBeVisible()

  await page.getByTestId('host-parent-tab-tools').click()
  await page.getByTestId('host-tab-logs').click()

  await expect(page.getByTestId('host-logs-heading')).toBeVisible()
  await expect(page.getByTestId('host-log-row-host-log-run-1')).toContainText('Software inventory')
  await expect(page.getByTestId('host-log-row-host-log-run-1')).toContainText('52 packages')
  await expect(page.getByTestId('host-log-row-host-log-run-2')).toContainText('Failed')

  await page.getByLabel('Select all').click()
  await expect(page.getByTestId('host-logs-selection')).toContainText('2 selected')
  await page.getByTestId('host-logs-delete-selected').click()

  await expect(page.getByTestId('host-log-row-host-log-run-1')).toHaveCount(0)
  await expect(page.getByTestId('host-log-row-host-log-run-2')).toHaveCount(0)
  await expect(page.getByTestId('host-logs-empty')).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        id: string
        deleted_at: string | null
        host_deleted_at: string | null
      }>>`
        SELECT
          task_runs.id,
          task_runs.deleted_at::text,
          task_run_hosts.deleted_at::text AS host_deleted_at
        FROM task_runs
        JOIN task_run_hosts ON task_run_hosts.task_run_id = task_runs.id
        WHERE task_runs.id IN ('host-log-run-1', 'host-log-run-2')
        ORDER BY task_runs.id
      `

      return rows
    })
    .toEqual([
      {
        id: 'host-log-run-1',
        deleted_at: expect.any(String),
        host_deleted_at: expect.any(String),
      },
      {
        id: 'host-log-run-2',
        deleted_at: expect.any(String),
        host_deleted_at: expect.any(String),
      },
    ])
})
