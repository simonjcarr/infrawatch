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

test('engineer can create a host-linked calendar event with participant roles across calendar views', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId } = await getOrgAndUserIds(sql)

  await sql`
    UPDATE "user"
    SET role = 'engineer', roles = '["engineer"]'::jsonb
    WHERE email = ${TEST_USER.email}
  `

  await sql`
    INSERT INTO hosts (id, organisation_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES ('calendar-host-1', ${orgId}, 'calendar-host-1', 'Calendar Host', 'Ubuntu 24.04', 'x86_64', '["10.70.0.10"]'::jsonb, 'online', NOW())
  `

  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, organisation_id, role, roles, is_active)
    VALUES ('calendar-approver-1', 'Calendar Approver', 'calendar-approver@example.com', true, NOW(), NOW(), ${orgId}, 'org_admin', '["org_admin"]'::jsonb, true)
  `

  await page.goto('/calendar')
  await expect(page.getByTestId('operations-calendar-heading')).toBeVisible()

  await page.getByTestId('calendar-new-event').click()
  await page.getByTestId('calendar-event-title').fill('Kernel patch planning')
  await page.getByTestId('calendar-event-description').fill('Plan operating system patching for the primary host.')
  await page.getByTestId('calendar-event-starts-at').fill('2026-05-08T10:00')
  await page.getByTestId('calendar-event-ends-at').fill('2026-05-08T11:30')
  await page.getByTestId('calendar-host-option-calendar-host-1').click()
  await page.getByTestId('calendar-participant-option-calendar-approver-1').click()
  await page.getByTestId('calendar-participant-role-calendar-approver-1').selectOption('approver')
  await page.getByTestId('calendar-event-submit').click()

  await expect(page.getByText('Kernel patch planning')).toBeVisible()

  for (const view of ['day', 'work-week', 'full-week', 'month', 'year']) {
    await page.getByTestId(`calendar-view-${view}`).click()
    await expect(page.getByText('Kernel patch planning')).toBeVisible()
  }

  const rows = await sql<Array<{ title: string; host_count: number; participant_role: string | null }>>`
    SELECT
      calendar_events.title,
      COUNT(DISTINCT calendar_event_hosts.host_id)::int AS host_count,
      MAX(calendar_event_participants.role) AS participant_role
    FROM calendar_events
    LEFT JOIN calendar_event_hosts ON calendar_event_hosts.event_id = calendar_events.id
    LEFT JOIN calendar_event_participants ON calendar_event_participants.event_id = calendar_events.id
    WHERE calendar_events.organisation_id = ${orgId}
      AND calendar_events.title = 'Kernel patch planning'
    GROUP BY calendar_events.id
  `

  expect(rows).toEqual([
    {
      title: 'Kernel patch planning',
      host_count: 1,
      participant_role: 'approver',
    },
  ])
})

test('dragging one recurring occurrence creates an exception without moving the series', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO calendar_events (
      id,
      organisation_id,
      created_by,
      title,
      starts_at,
      ends_at,
      all_day,
      timezone,
      status,
      category,
      recurrence_rule
    )
    VALUES (
      'calendar-series-1',
      ${orgId},
      ${userId},
      'Weekly maintenance window',
      '2026-05-04T09:00:00Z',
      '2026-05-04T10:00:00Z',
      false,
      'UTC',
      'planned',
      'patching',
      '{"freq":"weekly","interval":1,"byWeekday":["mo"],"count":4}'::jsonb
    )
  `

  await page.goto('/calendar')
  await expect(page.getByText('Weekly maintenance window')).toBeVisible()

  await page.evaluate(async () => {
    const move = window.__ctOpsCalendarTestMoveEvent
    if (!move) throw new Error('calendar test move helper was not registered')
    await move({
      eventId: 'calendar-series-1',
      recurrenceInstanceStartAt: '2026-05-11T09:00:00.000Z',
      startsAt: '2026-05-12T11:00:00.000Z',
      endsAt: '2026-05-12T12:00:00.000Z',
      scope: 'this',
    })
  })

  await expect(page.getByText('Weekly maintenance window')).toBeVisible()

  const rows = await sql<Array<{ series_id: string | null; exception_type: string | null; starts_at: string }>>`
    SELECT series_id, exception_type, starts_at::text
    FROM calendar_events
    WHERE organisation_id = ${orgId}
      AND (id = 'calendar-series-1' OR series_id = 'calendar-series-1')
    ORDER BY starts_at
  `

  expect(rows).toHaveLength(2)
  expect(rows[0]!.series_id).toBeNull()
  expect(rows[0]!.starts_at).toContain('2026-05-04 09:00:00')
  expect(rows[1]!.series_id).toBe('calendar-series-1')
  expect(rows[1]!.exception_type).toBe('modified')
  expect(rows[1]!.starts_at).toContain('2026-05-12 11:00:00')
})

test('read-only users can view calendar events but cannot create them', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    UPDATE "user"
    SET role = 'read_only', roles = '["read_only"]'::jsonb
    WHERE email = ${TEST_USER.email}
  `

  await sql`
    INSERT INTO calendar_events (id, organisation_id, created_by, title, starts_at, ends_at, all_day, timezone, status, category)
    VALUES ('calendar-readonly-1', ${orgId}, ${userId}, 'Read only maintenance', '2026-05-08T08:00:00Z', '2026-05-08T09:00:00Z', false, 'UTC', 'planned', 'maintenance')
  `

  await page.goto('/calendar')
  await expect(page.getByText('Read only maintenance')).toBeVisible()
  await expect(page.getByTestId('calendar-new-event')).toHaveCount(0)
})

declare global {
  interface Window {
    __ctOpsCalendarTestMoveEvent?: (input: {
      eventId: string
      recurrenceInstanceStartAt?: string
      startsAt: string
      endsAt: string
      scope: 'this' | 'series'
    }) => Promise<void>
  }
}
