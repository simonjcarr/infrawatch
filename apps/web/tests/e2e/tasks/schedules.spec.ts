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

test('admin can review, enable, and delete a scheduled task', async ({ authenticatedPage: page }) => {
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
      status,
      last_seen_at
    )
    VALUES (
      'schedule-host-1',
      ${orgId},
      'schedule-host-1',
      'Schedule Host',
      'Ubuntu 24.04',
      'x86_64',
      '["10.30.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await sql`
    INSERT INTO task_schedules (
      id,
      organisation_id,
      created_by,
      name,
      description,
      task_type,
      config,
      target_type,
      target_id,
      max_parallel,
      cron_expression,
      timezone,
      enabled,
      next_run_at
    )
    VALUES (
      'schedule-e2e-1',
      ${orgId},
      ${userId},
      'Weekly patch run',
      'Apply security patches to a critical host.',
      'patch',
      '{"mode":"security"}'::jsonb,
      'host',
      'schedule-host-1',
      1,
      '0 3 * * 1',
      'UTC',
      false,
      NOW() + INTERVAL '6 days'
    )
  `

  await page.goto('/tasks')

  await expect(page.getByTestId('task-schedules-heading')).toBeVisible()
  const scheduleRow = page.getByTestId('task-schedule-row-schedule-e2e-1')
  await expect(scheduleRow).toContainText('Weekly patch run')
  await expect(scheduleRow).toContainText('Patch')
  await expect(scheduleRow).toContainText('schedule-host-1')

  await page.getByTestId('task-schedule-toggle-schedule-e2e-1').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ enabled: boolean }>>`
        SELECT enabled
        FROM task_schedules
        WHERE id = 'schedule-e2e-1'
        LIMIT 1
      `
      return rows[0]?.enabled ?? null
    })
    .toBe(true)

  await page.getByTestId('task-schedule-delete-schedule-e2e-1').click()
  await page.getByTestId('task-schedule-delete-confirm').click()
  await expect(scheduleRow).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM task_schedules
        WHERE id = 'schedule-e2e-1'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .toBeTruthy()
})
