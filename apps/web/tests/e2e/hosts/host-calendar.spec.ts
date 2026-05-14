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
      ('host-calendar-event-1', ${instanceId}, ${userId}, 'Host kernel patch', 'Patch the current host.', '2026-05-20T09:00:00Z', '2026-05-20T10:00:00Z', false, 'UTC', 'confirmed', 'patching'),
      ('host-calendar-event-2', ${instanceId}, ${userId}, 'Host maintenance window', NULL, '2026-05-22T13:30:00Z', '2026-05-22T15:00:00Z', false, 'UTC', 'planned', 'maintenance'),
      ('host-calendar-event-other', ${instanceId}, ${userId}, 'Other host outage', NULL, '2026-05-21T09:00:00Z', '2026-05-21T10:00:00Z', false, 'UTC', 'planned', 'maintenance')
  `

  await sql`
    INSERT INTO calendar_event_hosts (instance_id, event_id, host_id)
    VALUES
      (${instanceId}, 'host-calendar-event-1', 'host-calendar-1'),
      (${instanceId}, 'host-calendar-event-2', 'host-calendar-1'),
      (${instanceId}, 'host-calendar-event-other', 'host-calendar-2')
  `

  await page.goto('/hosts/host-calendar-1')
  await expect(page.getByRole('heading', { name: 'Host Calendar One' })).toBeVisible()

  await page.getByTestId('host-parent-tab-admin').click()
  await page.getByTestId('host-tab-calendar').click()

  await expect(page.getByTestId('host-calendar-tab')).toBeVisible()
  const firstEventRow = page.getByTestId('host-calendar-event-host-calendar-event-1')
  await expect(firstEventRow).toContainText('Host kernel patch', { timeout: 15_000 })
  await expect(firstEventRow).toContainText('Confirmed')
  await expect(firstEventRow).toContainText('Patching')
  await expect(page.getByTestId('host-calendar-event-host-calendar-event-2')).toContainText('Host maintenance window')
  await expect(page.getByText('Other host outage')).toHaveCount(0)

  await firstEventRow.click()

  const detailsDialog = page.getByTestId('host-calendar-event-dialog')
  await expect(detailsDialog).toBeVisible()
  await expect(detailsDialog.getByRole('heading', { name: 'Host kernel patch' })).toBeVisible()
  await expect(detailsDialog).toContainText('Patch the current host.')
  await expect(detailsDialog).toContainText('20 May 2026, 09:00 - 20 May 2026, 10:00')
  await expect(detailsDialog).toContainText('UTC')
  await expect(detailsDialog).toContainText('One-off')
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
