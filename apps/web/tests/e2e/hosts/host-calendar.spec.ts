import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE, TEST_USER } from '../fixtures/seed'

async function getInstanceAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ instanceId: string; userId: string }> {
  const rows = await sql<Array<{ instance_id: string; user_id: string }>>`
    SELECT instance_settings.id AS instance_id, "user".id AS user_id
    FROM instance_settings
    JOIN "user" ON "user".instance_id = instance_settings.id
    WHERE instance_settings.slug = ${TEST_INSTANCE.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    instanceId: rows[0]!.instance_id,
    userId: rows[0]!.user_id,
  }
}

test('host admin calendar shows only events linked to the current host', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getInstanceAndUserIds(sql)

  await sql`
    INSERT INTO hosts (id, instance_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES
      ('host-calendar-1', ${instanceId}, 'host-calendar-1', 'Host Calendar One', 'Ubuntu 24.04', 'x86_64', '["10.70.0.10"]'::jsonb, 'online', NOW()),
      ('host-calendar-2', ${instanceId}, 'host-calendar-2', 'Host Calendar Two', 'Ubuntu 24.04', 'x86_64', '["10.70.0.11"]'::jsonb, 'online', NOW())
  `

  await sql`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, instance_id, role, roles, is_active)
    VALUES ('host-calendar-observer-1', 'Host Calendar Observer', 'host-calendar-observer@example.com', true, NOW(), NOW(), ${instanceId}, 'viewer', '["viewer"]'::jsonb, true)
  `

  await sql`
    INSERT INTO calendar_events (
      id,
      instance_id,
      created_by,
      title,
      description,
      starts_at,
      ends_at,
      all_day,
      timezone,
      status,
      category
    )
    VALUES
      ('host-calendar-event-1', ${instanceId}, NULL, 'Host kernel patch', 'Patch the current host.', date_trunc('day', NOW()) + interval '9 hours', date_trunc('day', NOW()) + interval '10 hours', false, 'UTC', 'confirmed', 'patching'),
      ('host-calendar-event-2', ${instanceId}, NULL, 'Host maintenance window', NULL, date_trunc('day', NOW()) + interval '1 day 13 hours 30 minutes', date_trunc('day', NOW()) + interval '1 day 15 hours', false, 'UTC', 'planned', 'maintenance'),
      ('host-calendar-event-past', ${instanceId}, NULL, 'Past maintenance window', NULL, date_trunc('day', NOW()) - interval '2 days' + interval '8 hours', date_trunc('day', NOW()) - interval '2 days' + interval '9 hours', false, 'UTC', 'completed', 'maintenance'),
      ('host-calendar-event-other', ${instanceId}, NULL, 'Other host outage', NULL, date_trunc('day', NOW()) + interval '2 days 9 hours', date_trunc('day', NOW()) + interval '2 days 10 hours', false, 'UTC', 'planned', 'maintenance')
  `

  await sql`
    INSERT INTO calendar_event_hosts (instance_id, event_id, host_id)
    VALUES
      (${instanceId}, 'host-calendar-event-1', 'host-calendar-1'),
      (${instanceId}, 'host-calendar-event-1', 'host-calendar-2'),
      (${instanceId}, 'host-calendar-event-2', 'host-calendar-1'),
      (${instanceId}, 'host-calendar-event-past', 'host-calendar-1'),
      (${instanceId}, 'host-calendar-event-other', 'host-calendar-2')
  `

  await sql`
    INSERT INTO calendar_event_participants (instance_id, event_id, user_id, role)
    VALUES
      (${instanceId}, 'host-calendar-event-1', ${userId}, 'implementer'),
      (${instanceId}, 'host-calendar-event-1', 'host-calendar-observer-1', 'observer')
  `

  await page.goto('/hosts/host-calendar-1')
  await expect(page.getByRole('heading', { name: 'Host Calendar One' })).toBeVisible()

  await page.getByTestId('host-parent-tab-admin').click()
  await page.getByTestId('host-tab-calendar').click()

  await expect(page.getByTestId('host-calendar-tab')).toBeVisible()
  const firstEventRow = page.getByTestId('host-calendar-event-host-calendar-event-1')
  await expect(firstEventRow).toContainText('Host kernel patch', { timeout: 15_000 })
  await expect(firstEventRow).not.toContainText('Patch the current host.')
  await expect(firstEventRow).toContainText('Confirmed')
  await expect(firstEventRow).toContainText('Patching')
  await expect(firstEventRow).toContainText('Linked to you')
  await expect(firstEventRow).toContainText('Today, 09:00 - 10:00')
  await expect(firstEventRow.getByTestId('host-calendar-event-date')).toHaveAttribute(
    'title',
    /^\d{1,2} [A-Z][a-z]{2} \d{4}, 09:00 - \d{1,2} [A-Z][a-z]{2} \d{4}, 10:00$/,
  )
  const secondEventRow = page.getByTestId('host-calendar-event-host-calendar-event-2')
  await expect(secondEventRow).toContainText('Host maintenance window')
  await expect(secondEventRow).not.toContainText('Linked to you')
  await expect(secondEventRow).toContainText('Tomorrow, 13:30 - 15:00')
  await expect(secondEventRow.getByTestId('host-calendar-event-date')).toHaveAttribute(
    'title',
    /^\d{1,2} [A-Z][a-z]{2} \d{4}, 13:30 - \d{1,2} [A-Z][a-z]{2} \d{4}, 15:00$/,
  )
  const pastEventRow = page.getByTestId('host-calendar-event-host-calendar-event-past')
  await expect(pastEventRow).toContainText('Past maintenance window')
  await expect(pastEventRow).toContainText('Past')
  await expect(page.getByText('Other host outage')).toHaveCount(0)

  await page.getByTestId('host-calendar-category-filter').click()
  await page.getByRole('option', { name: 'Patching' }).click()
  await expect(firstEventRow).toBeVisible()
  await expect(secondEventRow).toHaveCount(0)
  await page.getByTestId('host-calendar-category-filter').click()
  await page.getByRole('option', { name: 'All categories' }).click()

  await page.getByTestId('host-calendar-status-filter').click()
  await page.getByRole('option', { name: 'Completed' }).click()
  await expect(pastEventRow).toBeVisible()
  await expect(firstEventRow).toHaveCount(0)

  await page.getByTestId('host-calendar-status-filter').click()
  await page.getByRole('option', { name: 'All statuses' }).click()
  await page.getByTestId('host-calendar-event-host-calendar-event-1').click()

  const detailsDialog = page.getByTestId('host-calendar-event-dialog')
  await expect(detailsDialog).toBeVisible()
  await expect(detailsDialog.getByRole('heading', { name: 'Host kernel patch' })).toBeVisible()
  await expect(detailsDialog).toContainText('Patch the current host.')
  await expect(detailsDialog).toContainText('Today, 09:00 - Today, 10:00')
  await expect(detailsDialog.getByTestId('host-calendar-event-detail-date')).toHaveAttribute(
    'title',
    /^\d{1,2} [A-Z][a-z]{2} \d{4}, 09:00 - \d{1,2} [A-Z][a-z]{2} \d{4}, 10:00$/,
  )
  await expect(detailsDialog).toContainText('UTC')
  await expect(detailsDialog).toContainText('One-off')

  await detailsDialog.getByRole('tab', { name: 'Hosts' }).click()
  await expect(detailsDialog.getByTestId('host-calendar-event-hosts-tab')).toContainText('Host Calendar One')
  await expect(detailsDialog.getByTestId('host-calendar-event-hosts-tab')).toContainText('host-calendar-1')
  await expect(detailsDialog.getByTestId('host-calendar-event-hosts-tab')).toContainText('Current host')
  await expect(detailsDialog.getByTestId('host-calendar-event-hosts-tab')).toContainText('Host Calendar Two')
  await expect(detailsDialog.getByTestId('host-calendar-event-hosts-tab')).toContainText('host-calendar-2')

  await detailsDialog.getByRole('tab', { name: 'Participants' }).click()
  await expect(detailsDialog.getByTestId('host-calendar-event-participants-tab')).toContainText(TEST_USER.email)
  await expect(detailsDialog.getByTestId('host-calendar-event-participants-tab')).toContainText('Implementer')
  await expect(detailsDialog.getByTestId('host-calendar-event-participants-tab')).toContainText('host-calendar-observer@example.com')
  await expect(detailsDialog.getByTestId('host-calendar-event-participants-tab')).toContainText('Observer')

  await detailsDialog.getByRole('tab', { name: 'Activity Detail' }).click()
  await expect(detailsDialog.getByTestId('host-calendar-event-description')).toContainText('Patch the current host.')
})

test('host calendar event dialog keeps long descriptions scrollable', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getInstanceAndUserIds(sql)
  const longDescription = Array.from({ length: 120 }, (_, index) => `Long description line ${index + 1}`).join('\n')

  await sql`
    INSERT INTO hosts (id, instance_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES ('host-calendar-long-description', ${instanceId}, 'host-calendar-long-description', 'Host Calendar Long Description', 'Ubuntu 24.04', 'x86_64', '["10.70.0.14"]'::jsonb, 'online', NOW())
  `

  await sql`
    INSERT INTO calendar_events (
      id,
      instance_id,
      created_by,
      title,
      description,
      starts_at,
      ends_at,
      all_day,
      timezone,
      status,
      category
    )
    VALUES (
      'host-calendar-long-description-event',
      ${instanceId},
      ${userId},
      'Long description change',
      ${longDescription},
      date_trunc('day', NOW()) + interval '11 hours',
      date_trunc('day', NOW()) + interval '12 hours',
      false,
      'UTC',
      'planned',
      'change'
    )
  `

  await sql`
    INSERT INTO calendar_event_hosts (instance_id, event_id, host_id)
    VALUES (${instanceId}, 'host-calendar-long-description-event', 'host-calendar-long-description')
  `

  await page.goto('/hosts/host-calendar-long-description')
  await expect(page.getByRole('heading', { name: 'Host Calendar Long Description' })).toBeVisible()

  await page.getByTestId('host-parent-tab-admin').click()
  await page.getByTestId('host-tab-calendar').click()
  await page.getByTestId('host-calendar-event-host-calendar-long-description-event').click()

  const detailsDialog = page.getByTestId('host-calendar-event-dialog')
  const description = page.getByTestId('host-calendar-event-description')
  await expect(detailsDialog).toBeVisible()
  await expect(description).toContainText('Long description line 120')

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const dialogBox = await detailsDialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height)

  const isDescriptionScrollable = await description.evaluate((element) => (
    element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY !== 'visible'
  ))
  expect(isDescriptionScrollable).toBe(true)
})

test('host admin calendar shows an empty state when no events are linked', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId } = await getInstanceAndUserIds(sql)

  await sql`
    INSERT INTO hosts (id, instance_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES ('host-calendar-empty', ${instanceId}, 'host-calendar-empty', 'Host Calendar Empty', 'Ubuntu 24.04', 'x86_64', '["10.70.0.12"]'::jsonb, 'online', NOW())
  `

  await page.goto('/hosts/host-calendar-empty')
  await expect(page.getByRole('heading', { name: 'Host Calendar Empty' })).toBeVisible()

  await page.getByTestId('host-parent-tab-admin').click()
  await page.getByTestId('host-tab-calendar').click()

  await expect(page.getByTestId('host-calendar-tab')).toContainText('No calendar events linked to this host')
})

test('host admin calendar picks up newly linked events without a browser refresh', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getInstanceAndUserIds(sql)

  await sql`
    INSERT INTO hosts (id, instance_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES ('host-calendar-live', ${instanceId}, 'host-calendar-live', 'Host Calendar Live', 'Ubuntu 24.04', 'x86_64', '["10.70.0.13"]'::jsonb, 'online', NOW())
  `

  await page.goto('/hosts/host-calendar-live')
  await expect(page.getByRole('heading', { name: 'Host Calendar Live' })).toBeVisible()

  await page.getByTestId('host-parent-tab-admin').click()
  await page.getByTestId('host-tab-calendar').click()

  await expect(page.getByTestId('host-calendar-tab')).toContainText('No calendar events linked to this host')

  await sql`
    INSERT INTO calendar_events (
      id,
      instance_id,
      created_by,
      title,
      description,
      starts_at,
      ends_at,
      all_day,
      timezone,
      status,
      category
    )
    VALUES (
      'host-calendar-live-event',
      ${instanceId},
      ${userId},
      'Live host patch',
      'Created while the host calendar tab is open.',
      '2026-05-24T09:00:00Z',
      '2026-05-24T10:00:00Z',
      false,
      'UTC',
      'planned',
      'patching'
    )
  `

  await sql`
    INSERT INTO calendar_event_hosts (instance_id, event_id, host_id)
    VALUES (${instanceId}, 'host-calendar-live-event', 'host-calendar-live')
  `

  await expect(page.getByTestId('host-calendar-event-host-calendar-live-event')).toContainText('Live host patch', { timeout: 15_000 })
})
