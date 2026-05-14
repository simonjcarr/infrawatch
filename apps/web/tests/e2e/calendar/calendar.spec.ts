import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE, TEST_USER } from '../fixtures/seed'

const CALENDAR_TEST_NOW = new Date('2026-05-09T12:00:00Z')

async function getInstanceAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ instanceId: string; userId: string }> {
  const rows = await sql<Array<{ instance_id: string; user_id: string }>>`
    SELECT instanceSettings.id AS instance_id, "user".id AS user_id
    FROM instance_settings
    JOIN "user" ON "user".instance_id = instanceSettings.id
    WHERE instanceSettings.slug = ${TEST_INSTANCE.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    instanceId: rows[0]!.instance_id,
    userId: rows[0]!.user_id,
  }
}

test('engineer can create a host-linked calendar event with participant roles across calendar views', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId } = await getInstanceAndUserIds(sql)

  await sql`
    UPDATE "user"
    SET role = 'engineer', roles = '["engineer"]'::jsonb
    WHERE email = ${TEST_USER.email}
  `

  await sql`
    INSERT INTO hosts (id, instance_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES ('calendar-host-1', ${instanceId}, 'calendar-host-1', 'Calendar Host', 'Ubuntu 24.04', 'x86_64', '["10.70.0.10"]'::jsonb, 'online', NOW())
  `

  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, instance_id, role, roles, is_active)
    VALUES ('calendar-approver-1', 'Calendar Approver', 'calendar-approver@example.com', true, NOW(), NOW(), ${instanceId}, 'instance_admin', '["instance_admin"]'::jsonb, true)
  `

  await page.clock.setFixedTime(CALENDAR_TEST_NOW)
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
  const timedEvent = page.locator('.ct-ops-calendar-time-day-stack .ct-ops-calendar-event').filter({ hasText: 'Kernel patch planning' }).first()
  await expect(timedEvent).toBeVisible()
  const [timedEventBox, timeGridBox] = await Promise.all([
    timedEvent.boundingBox(),
    page.getByTestId('calendar-time-scroll').boundingBox(),
  ])
  expect(timedEventBox).not.toBeNull()
  expect(timeGridBox).not.toBeNull()
  expect(timedEventBox!.height).toBeGreaterThan(40)
  expect(timedEventBox!.y).toBeGreaterThanOrEqual(timeGridBox!.y)
  expect(timedEventBox!.y + timedEventBox!.height).toBeLessThanOrEqual(timeGridBox!.y + timeGridBox!.height + 1)

  await page.getByTestId('calendar-view-day').click()
  await page.getByTestId('calendar-prev').click()
  await expect(page.getByText('Kernel patch planning')).toBeVisible()

  for (const view of ['work-week', 'full-week', 'month', 'year']) {
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
    WHERE calendar_events.instance_id = ${instanceId}
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
  const { instanceId, userId } = await getInstanceAndUserIds(sql)

  await sql`
    INSERT INTO calendar_events (
      id,
      instance_id,
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
      ${instanceId},
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

  await page.clock.setFixedTime(CALENDAR_TEST_NOW)
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
    WHERE instance_id = ${instanceId}
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

test('overlapping timed calendar events render side by side', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getInstanceAndUserIds(sql)

  await sql`
    INSERT INTO calendar_events (id, instance_id, created_by, title, starts_at, ends_at, all_day, timezone, status, category)
    VALUES
      ('calendar-overlap-1', ${instanceId}, ${userId}, 'First overlapping maintenance', '2026-05-08T10:00:00Z', '2026-05-08T11:00:00Z', false, 'UTC', 'planned', 'maintenance'),
      ('calendar-overlap-2', ${instanceId}, ${userId}, 'Second overlapping maintenance', '2026-05-08T10:00:00Z', '2026-05-08T11:00:00Z', false, 'UTC', 'planned', 'patching')
  `

  await page.clock.setFixedTime(CALENDAR_TEST_NOW)
  await page.goto('/calendar')

  const firstEvent = page.getByTestId('calendar-rendered-event-calendar-overlap-1')
  const secondEvent = page.getByTestId('calendar-rendered-event-calendar-overlap-2')
  await expect(firstEvent).toBeVisible()
  await expect(secondEvent).toBeVisible()

  const [firstBox, secondBox, dayBox] = await Promise.all([
    firstEvent.boundingBox(),
    secondEvent.boundingBox(),
    page.getByTestId('calendar-time-day-2026-05-08').boundingBox(),
  ])

  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  expect(dayBox).not.toBeNull()
  expect(Math.abs(firstBox!.y - secondBox!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(firstBox!.width - secondBox!.width)).toBeLessThanOrEqual(1)
  expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(secondBox!.x + 1)
  expect(firstBox!.width).toBeLessThan(dayBox!.width * 0.6)
  expect(secondBox!.width).toBeLessThan(dayBox!.width * 0.6)
})

test('read-only users can view calendar events but cannot create them', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getInstanceAndUserIds(sql)

  await sql`
    UPDATE "user"
    SET role = 'read_only', roles = '["read_only"]'::jsonb
    WHERE email = ${TEST_USER.email}
  `

  await sql`
    INSERT INTO calendar_events (id, instance_id, created_by, title, starts_at, ends_at, all_day, timezone, status, category)
    VALUES ('calendar-readonly-1', ${instanceId}, ${userId}, 'Read only maintenance', '2026-05-08T08:00:00Z', '2026-05-08T09:00:00Z', false, 'UTC', 'planned', 'maintenance')
  `

  await page.clock.setFixedTime(CALENDAR_TEST_NOW)
  await page.goto('/calendar')
  await expect(page.getByText('Read only maintenance')).toBeVisible()
  await expect(page.getByTestId('calendar-new-event')).toHaveCount(0)
})

test('calendar views use operational calendar labels and grid structure', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(CALENDAR_TEST_NOW)
  await page.goto('/calendar')
  await expect(page.getByTestId('operations-calendar-heading')).toBeVisible()

  await page.getByTestId('calendar-view-work-week').click()
  await expect(page.getByTestId('calendar-period-title')).toContainText(/^W\/B \d{1,2} [A-Z][a-z]{2} \d{4}$/)
  await expect(page.getByTestId('calendar-time-label-09-00')).toBeVisible()
  await expect(page.getByTestId('calendar-time-label-09-30')).toBeVisible()
  await expect(page.getByTestId('calendar-time-label-17-00')).toBeVisible()
  await expect(page.locator('[data-testid^="calendar-time-header-"]').filter({ hasText: /^Sun/ })).toHaveCount(0)
  await expect(page.getByTestId('calendar-time-grid').locator('.ct-ops-calendar-month-day-number')).toHaveCount(0)
  expect(await page.locator('.ct-ops-calendar-time-slot').count()).toBeGreaterThanOrEqual(48 * 5)
  const timeSlotHeights = await page.locator('.ct-ops-calendar-time-slot').evaluateAll((slots) =>
    slots.map((slot) => slot.getBoundingClientRect().height),
  )
  expect(timeSlotHeights.length).toBeGreaterThanOrEqual(48)
  expect(Math.min(...timeSlotHeights)).toBeGreaterThanOrEqual(28)
  const visibleSlotHeight = timeSlotHeights[0]!
  const scrollerHeight = await page.getByTestId('calendar-time-scroll').evaluate((body) => body.getBoundingClientRect().height)
  expect(visibleSlotHeight * 16).toBeGreaterThanOrEqual(scrollerHeight * 0.85)
  const firstVisibleTimeLabel = await page.getByTestId('calendar-time-scroll').evaluate((scroller) => {
    const scrollerTop = scroller.getBoundingClientRect().top
    const labels = Array.from(scroller.querySelectorAll('.ct-ops-calendar-time-label'))
    return labels.find((label) => label.getBoundingClientRect().top >= scrollerTop - 1)?.textContent
  })
  expect(firstVisibleTimeLabel).toBe('09:00')
  await expect.poll(async () =>
    page.locator('main').evaluate((main) => main.scrollHeight - main.clientHeight),
  ).toBeLessThanOrEqual(1)

  const controlsTop = await page.getByTestId('calendar-view-work-week').evaluate((button) => button.getBoundingClientRect().top)
  const headerTop = await page.locator('[data-testid^="calendar-time-header-"]').first().evaluate((header) => header.getBoundingClientRect().top)
  const scrollerTopBefore = await page.getByTestId('calendar-time-scroll').evaluate((scroller) => scroller.scrollTop)
  const scrollerBox = await page.getByTestId('calendar-time-scroll').boundingBox()
  expect(scrollerBox).not.toBeNull()
  await page.mouse.move(scrollerBox!.x + scrollerBox!.width / 2, scrollerBox!.y + scrollerBox!.height / 2)
  await page.mouse.wheel(0, 420)
  await expect.poll(async () => page.getByTestId('calendar-time-scroll').evaluate((scroller) => scroller.scrollTop)).toBeGreaterThan(scrollerTopBefore)
  expect(await page.locator('main').evaluate((main) => main.scrollTop)).toBe(0)
  expect(await page.getByTestId('calendar-view-work-week').evaluate((button) => button.getBoundingClientRect().top)).toBeCloseTo(controlsTop, 0)
  expect(await page.locator('[data-testid^="calendar-time-header-"]').first().evaluate((header) => header.getBoundingClientRect().top)).toBeCloseTo(headerTop, 0)

  await page.getByTestId('calendar-view-full-week').click()
  await expect(page.locator('[data-testid^="calendar-time-header-"]').filter({ hasText: /^Mon, \d{1,2} [A-Z][a-z]{2}$/ }).first()).toBeVisible()
  await expect(page.locator('[data-testid^="calendar-time-header-"]').filter({ hasText: /^Sun, \d{1,2} [A-Z][a-z]{2}$/ }).first()).toBeVisible()
  await expect(page.getByTestId('calendar-time-grid').locator('.ct-ops-calendar-month-day-number')).toHaveCount(0)

  await page.getByTestId('calendar-view-month').click()
  await expect(page.getByTestId('calendar-period-title')).toContainText(/^[A-Z][a-z]{2} \d{4}$/)
  await expect(page.locator('.ct-ops-calendar-month-day')).toHaveCount(42)
  await expect(page.locator('.ct-ops-calendar-month-day').first()).toBeVisible()
  await expect(page.locator('.ct-ops-calendar-month-day-number').filter({ hasText: /[A-Z][a-z]{2}/ }).first()).toBeVisible()

  await page.getByTestId('calendar-view-year').click()
  await expect(page.getByTestId('calendar-period-title')).toContainText(/^\d{4}$/)
  await expect(page.locator('.ct-ops-calendar-year-month')).toHaveCount(12)
  await expect(page.getByTestId('calendar-year-month-Jan')).toBeVisible()
  await expect(page.locator('.ct-ops-calendar-year-day')).not.toHaveCount(0)
  await expect(page.getByText('Calendar range cannot exceed 370 days')).toHaveCount(0)
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
