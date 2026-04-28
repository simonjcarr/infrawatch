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

test('admin can create a patch schedule from the new schedule form', async ({ authenticatedPage: page }) => {
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
    VALUES (
      'schedule-create-host-1',
      ${orgId},
      'schedule-create-host-1',
      'Schedule Create Host',
      'Ubuntu 24.04',
      'x86_64',
      '["10.40.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await page.goto('/tasks/schedules/new')

  await expect(page.getByTestId('task-schedule-heading-create')).toBeVisible()
  await page.getByLabel('Name').fill('Nightly patch run')
  await page.getByLabel('Description (optional)').fill('Install all updates every night.')

  await page.getByTestId('task-schedule-task-type').click()
  await page.getByRole('option', { name: 'Patch' }).click()

  await page.getByTestId('task-schedule-target-id').click()
  await page.getByRole('option', { name: /schedule-create-host-1/i }).click()

  await page.getByLabel('Cron expression (5 fields: minute hour dom month dow)').fill('15 2 * * *')
  await page.getByTestId('task-schedule-timezone').click()
  await page.getByRole('option', { name: 'Europe/London' }).click()

  await expect(page.getByTestId('task-schedule-preview-list')).toBeVisible()

  await page.getByTestId('task-schedule-submit-create').click()

  await expect(page).toHaveURL(/\/tasks$/)
  const scheduleRow = page.getByRole('row', { name: /Nightly patch run/i })
  await expect(scheduleRow).toContainText('Patch')
  await expect(scheduleRow).toContainText('schedule-create-host-1')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        name: string
        cron_expression: string
        timezone: string
        target_id: string
        task_type: string
        config: { mode?: string }
      }>>`
        SELECT name, cron_expression, timezone, target_id, task_type, config
        FROM task_schedules
        WHERE organisation_id = ${orgId}
          AND name = 'Nightly patch run'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      name: 'Nightly patch run',
      cron_expression: '15 2 * * *',
      timezone: 'Europe/London',
      target_id: 'schedule-create-host-1',
      task_type: 'patch',
      config: { mode: 'all' },
    })
})

test('admin can create a security-only patch schedule for a host group', async ({ authenticatedPage: page }) => {
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
        'schedule-group-host-1',
        ${orgId},
        'schedule-group-host-1',
        'Schedule Group Host 1',
        'Ubuntu 24.04',
        'x86_64',
        '["10.50.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'schedule-group-host-2',
        ${orgId},
        'schedule-group-host-2',
        'Schedule Group Host 2',
        'Ubuntu 24.04',
        'arm64',
        '["10.50.0.11"]'::jsonb,
        'online',
        NOW()
      )
  `

  await sql`
    INSERT INTO host_groups (
      id,
      organisation_id,
      name,
      description
    )
    VALUES (
      'schedule-host-group-1',
      ${orgId},
      'Production Linux',
      'Production patch window group'
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
        'schedule-group-member-1',
        ${orgId},
        'schedule-host-group-1',
        'schedule-group-host-1'
      ),
      (
        'schedule-group-member-2',
        ${orgId},
        'schedule-host-group-1',
        'schedule-group-host-2'
      )
  `

  await page.goto('/tasks/schedules/new')

  await expect(page.getByTestId('task-schedule-heading-create')).toBeVisible()
  await page.getByLabel('Name').fill('Weekly security patch wave')
  await page.getByLabel('Description (optional)').fill('Apply security-only updates to the production group.')

  await page.getByTestId('task-schedule-task-type').click()
  await page.getByRole('option', { name: 'Patch' }).click()
  await page.getByTestId('task-schedule-patch-mode').click()
  await page.getByRole('option', { name: 'Security updates only' }).click()

  await page.getByTestId('task-schedule-target-type').click()
  await page.getByRole('option', { name: 'Host group' }).click()
  await page.getByTestId('task-schedule-target-id').click()
  await page.getByRole('option', { name: 'Production Linux' }).click()
  await page.getByLabel('Max parallel hosts').fill('2')

  await page.getByLabel('Cron expression (5 fields: minute hour dom month dow)').fill('0 1 * * 1')
  await page.getByTestId('task-schedule-timezone').click()
  await page.getByRole('option', { name: 'UTC' }).click()

  await expect(page.getByTestId('task-schedule-preview-list')).toBeVisible()

  await page.getByTestId('task-schedule-submit-create').click()

  await expect(page).toHaveURL(/\/tasks$/)
  const scheduleRow = page.getByRole('row', { name: /Weekly security patch wave/i })
  await expect(scheduleRow).toContainText('Patch')
  await expect(scheduleRow).toContainText('Production Linux')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        name: string
        cron_expression: string
        timezone: string
        target_type: string
        target_id: string
        max_parallel: number
        task_type: string
        config: { mode?: string }
      }>>`
        SELECT name, cron_expression, timezone, target_type, target_id, max_parallel, task_type, config
        FROM task_schedules
        WHERE organisation_id = ${orgId}
          AND name = 'Weekly security patch wave'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      name: 'Weekly security patch wave',
      cron_expression: '0 1 * * 1',
      timezone: 'UTC',
      target_type: 'group',
      target_id: 'schedule-host-group-1',
      max_parallel: 2,
      task_type: 'patch',
      config: { mode: 'security' },
    })
})

test('admin can create a custom script schedule for a single host', async ({ authenticatedPage: page }) => {
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
    VALUES (
      'schedule-script-host-1',
      ${orgId},
      'schedule-script-host-1',
      'Schedule Script Host',
      'Ubuntu 24.04',
      'x86_64',
      '["10.60.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await page.goto('/tasks/schedules/new')

  await expect(page.getByTestId('task-schedule-heading-create')).toBeVisible()
  await page.getByLabel('Name').fill('Daily diagnostics script')
  await page.getByLabel('Description (optional)').fill('Collect host diagnostics every morning.')

  await page.getByTestId('task-schedule-task-type').click()
  await page.getByRole('option', { name: 'Custom script' }).click()
  await page.getByTestId('task-schedule-script-interpreter').click()
  await page.getByRole('option', { name: 'python3' }).click()
  await page.getByTestId('task-schedule-script-body').fill('print(\"diagnostics\")')
  await page.getByTestId('task-schedule-script-timeout').fill('120')

  await page.getByTestId('task-schedule-target-id').click()
  await page.getByRole('option', { name: /schedule-script-host-1/i }).click()

  await page.getByLabel('Cron expression (5 fields: minute hour dom month dow)').fill('30 6 * * *')
  await page.getByTestId('task-schedule-timezone').click()
  await page.getByRole('option', { name: 'America/New_York' }).click()

  await expect(page.getByTestId('task-schedule-preview-list')).toBeVisible()

  await page.getByTestId('task-schedule-submit-create').click()

  await expect(page).toHaveURL(/\/tasks$/)
  const scheduleRow = page.getByRole('row', { name: /Daily diagnostics script/i })
  await expect(scheduleRow).toContainText('Custom script')
  await expect(scheduleRow).toContainText('schedule-script-host-1')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        name: string
        cron_expression: string
        timezone: string
        target_type: string
        target_id: string
        task_type: string
        config: { script?: string; interpreter?: string; timeout_seconds?: number }
      }>>`
        SELECT name, cron_expression, timezone, target_type, target_id, task_type, config
        FROM task_schedules
        WHERE organisation_id = ${orgId}
          AND name = 'Daily diagnostics script'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      name: 'Daily diagnostics script',
      cron_expression: '30 6 * * *',
      timezone: 'America/New_York',
      target_type: 'host',
      target_id: 'schedule-script-host-1',
      task_type: 'custom_script',
      config: {
        script: 'print("diagnostics")',
        interpreter: 'python3',
        timeout_seconds: 120,
      },
    })
})
