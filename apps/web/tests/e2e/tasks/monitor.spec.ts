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

test('admin can review a completed grouped task run and switch between host outputs', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO host_groups (
      id,
      organisation_id,
      name,
      description
    )
    VALUES (
      'task-monitor-group-1',
      ${orgId},
      'Task Monitor Group',
      'Used to verify the task run monitor view'
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
    VALUES
      (
        'task-monitor-host-1',
        ${orgId},
        'task-monitor-node-1',
        'Task Monitor Alpha',
        'Ubuntu 24.04',
        'x86_64',
        '["10.90.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'task-monitor-host-2',
        ${orgId},
        'task-monitor-node-2',
        'Task Monitor Beta',
        'Ubuntu 24.04',
        'arm64',
        '["10.90.0.11"]'::jsonb,
        'online',
        NOW()
      )
  `

  await sql`
    INSERT INTO host_group_members (
      id,
      organisation_id,
      group_id,
      host_id
    )
    VALUES
      (
        'task-monitor-member-1',
        ${orgId},
        'task-monitor-group-1',
        'task-monitor-host-1'
      ),
      (
        'task-monitor-member-2',
        ${orgId},
        'task-monitor-group-1',
        'task-monitor-host-2'
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
    VALUES (
      'task-monitor-run-1',
      ${orgId},
      ${userId},
      'group',
      'task-monitor-group-1',
      'patch',
      '{"mode":"security"}'::jsonb,
      1,
      'completed',
      NOW() - INTERVAL '10 minutes',
      NOW() - INTERVAL '2 minutes'
    )
  `

  await sql`
    INSERT INTO task_run_hosts (
      id,
      organisation_id,
      task_run_id,
      host_id,
      status,
      exit_code,
      raw_output,
      result,
      started_at,
      completed_at
    )
    VALUES
      (
        'task-monitor-run-host-1',
        ${orgId},
        'task-monitor-run-1',
        'task-monitor-host-1',
        'success',
        0,
        'Fetched package lists\nInstalled openssl\nReboot required',
        '{"packages_updated":[{"name":"openssl","from_version":"3.0.2","to_version":"3.0.3"}],"reboot_required":true}'::jsonb,
        NOW() - INTERVAL '10 minutes',
        NOW() - INTERVAL '6 minutes'
      ),
      (
        'task-monitor-run-host-2',
        ${orgId},
        'task-monitor-run-1',
        'task-monitor-host-2',
        'failed',
        23,
        'Failed to lock apt cache',
        '{"packages_updated":[],"reboot_required":false}'::jsonb,
        NOW() - INTERVAL '9 minutes',
        NOW() - INTERVAL '5 minutes'
      )
  `

  await page.goto('/tasks/task-monitor-run-1')

  await expect(page.getByRole('link', { name: 'Back to group' })).toHaveAttribute('href', '/hosts/groups/task-monitor-group-1')
  await expect(page.getByRole('heading', { name: 'Patch — security updates' })).toBeVisible()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(page.getByText('Reboot required', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/2 \/ 2 hosts done/)).toBeVisible()
  await expect(page.getByText(/1 succeeded/)).toBeVisible()
  await expect(page.getByText(/1 failed/)).toBeVisible()
  await expect(page.getByText('100%')).toBeVisible()

  await expect(page.getByRole('button', { name: /Task Monitor Alpha/i })).toBeVisible()
  await expect(page.getByText('Fetched package lists')).toBeVisible()
  await expect(page.getByText('Installed openssl')).toBeVisible()
  await expect(page.getByText('1 package updated')).toBeVisible()

  await page.getByRole('button', { name: /Task Monitor Beta/i }).click()
  await expect(page.getByText('Failed to lock apt cache')).toBeVisible()
  await expect(page.getByRole('button', { name: /Task Monitor Beta/i })).toContainText('Exit code: 23')
})
