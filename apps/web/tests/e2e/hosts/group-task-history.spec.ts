import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { getSeededTestUserContext } from '../fixtures/seed'

test('authenticated user can bulk delete task history from a host group', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getSeededTestUserContext()

  await sql`
    INSERT INTO host_groups (id, organisation_id, name, description)
    VALUES (
      'group-task-history',
      ${instanceId},
      'Task History Group',
      'Used to verify task history cleanup'
    )
  `

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
      'group-task-history-host',
      ${instanceId},
      'ops-01',
      'Ops Host 01',
      'linux',
      'x86_64',
      '["10.80.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await sql`
    INSERT INTO host_group_members (id, organisation_id, group_id, host_id)
    VALUES (
      'group-task-history-member',
      ${instanceId},
      'group-task-history',
      'group-task-history-host'
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
        'group-task-run-patch',
        ${instanceId},
        ${userId},
        'group',
        'group-task-history',
        'patch',
        '{"mode":"all"}'::jsonb,
        1,
        'completed',
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '110 minutes'
      ),
      (
        'group-task-run-service',
        ${instanceId},
        ${userId},
        'group',
        'group-task-history',
        'service',
        '{"service_name":"nginx","action":"restart"}'::jsonb,
        1,
        'failed',
        NOW() - INTERVAL '1 hour',
        NOW() - INTERVAL '50 minutes'
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
        'group-task-run-host-patch',
        ${instanceId},
        'group-task-run-patch',
        'group-task-history-host',
        'success',
        '{"packages_updated":[],"reboot_required":false}'::jsonb,
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '110 minutes'
      ),
      (
        'group-task-run-host-service',
        ${instanceId},
        'group-task-run-service',
        'group-task-history-host',
        'failed',
        '{"service_name":"nginx","action":"restart","is_active":false}'::jsonb,
        NOW() - INTERVAL '1 hour',
        NOW() - INTERVAL '50 minutes'
      )
  `

  await page.goto('/hosts/groups/group-task-history')

  await expect(page.getByTestId('host-group-detail-heading')).toContainText('Task History Group')
  await expect(page.getByTestId('host-group-task-run-row-group-task-run-patch')).toBeVisible()
  await expect(page.getByTestId('host-group-task-run-row-group-task-run-service')).toBeVisible()

  await page.getByLabel('Select all').click()
  await expect(page.getByTestId('host-group-task-runs-selection')).toContainText('2 selected')
  await page.getByTestId('host-group-task-runs-delete-selected').click()

  await expect(page.getByTestId('host-group-task-run-row-group-task-run-patch')).toHaveCount(0)
  await expect(page.getByTestId('host-group-task-run-row-group-task-run-service')).toHaveCount(0)
  await expect(page.getByTestId('host-group-task-runs-empty')).toBeVisible()

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
        WHERE task_runs.id IN ('group-task-run-patch', 'group-task-run-service')
        ORDER BY task_runs.id
      `

      return rows
    })
    .toEqual([
      {
        id: 'group-task-run-patch',
        deleted_at: expect.any(String),
        host_deleted_at: expect.any(String),
      },
      {
        id: 'group-task-run-service',
        deleted_at: expect.any(String),
        host_deleted_at: expect.any(String),
      },
    ])
})
