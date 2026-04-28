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

test('authenticated user can review, filter, and bulk delete notifications', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO notifications (
      id,
      organisation_id,
      user_id,
      subject,
      body,
      severity,
      resource_type,
      resource_id,
      read,
      created_at
    )
    VALUES
      (
        'notification-unread-critical',
        ${orgId},
        ${userId},
        'CPU usage is above threshold',
        'CPU usage on alpha-node exceeded the configured threshold.',
        'critical',
        'host',
        'host-alpha',
        false,
        NOW() - INTERVAL '10 minutes'
      ),
      (
        'notification-unread-warning',
        ${orgId},
        ${userId},
        'Disk usage is climbing',
        'Disk usage on beta-node crossed the warning threshold.',
        'warning',
        'host',
        'host-beta',
        false,
        NOW() - INTERVAL '5 minutes'
      ),
      (
        'notification-read-info',
        ${orgId},
        ${userId},
        'Inventory scan completed',
        'The latest inventory scan completed successfully.',
        'info',
        'host',
        'host-gamma',
        true,
        NOW() - INTERVAL '2 minutes'
      )
  `

  await page.goto('/notifications')

  await expect(page.getByTestId('notifications-heading')).toBeVisible()
  await expect(page.getByTestId('notifications-tab-unread')).toContainText('2')
  await expect(page.getByTestId('notification-card-notification-unread-critical')).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-unread-warning')).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-read-info')).toBeVisible()

  await page.getByTestId('notification-card-notification-unread-critical').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ read: boolean }>>`
        SELECT read
        FROM notifications
        WHERE id = 'notification-unread-critical'
        LIMIT 1
      `
      return rows[0]?.read ?? null
    })
    .toBe(true)

  await page.getByTestId('notifications-tab-unread').click()
  await expect(page.getByTestId('notification-card-notification-unread-critical')).toHaveCount(0)
  await expect(page.getByTestId('notification-card-notification-unread-warning')).toBeVisible()

  await page.getByTestId('notifications-select-all').click()
  await page.getByTestId('notifications-bulk-delete').click()

  await expect(page.getByText('No unread notifications')).toBeVisible()

  const rows = await sql<Array<{ id: string; read: boolean; deleted_at: Date | null }>>`
    SELECT id, read, deleted_at
    FROM notifications
    WHERE id IN ('notification-unread-critical', 'notification-unread-warning', 'notification-read-info')
    ORDER BY id ASC
  `

  expect(rows).toEqual([
    {
      id: 'notification-read-info',
      read: true,
      deleted_at: null,
    },
    {
      id: 'notification-unread-critical',
      read: true,
      deleted_at: null,
    },
    {
      id: 'notification-unread-warning',
      read: false,
      deleted_at: expect.any(Date),
    },
  ])
})
