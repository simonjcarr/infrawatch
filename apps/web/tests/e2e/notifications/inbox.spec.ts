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
  const unreadCriticalCard = page.getByTestId('notification-card-notification-unread-critical')
  await expect(unreadCriticalCard).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-unread-warning')).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-read-info')).toBeVisible()

  await unreadCriticalCard.getByText('CPU usage is above threshold').click()

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

test('authenticated user can mark all unread notifications as read', async ({ authenticatedPage: page }) => {
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
        'notification-mark-all-read-1',
        ${orgId},
        ${userId},
        'Certificate expires soon',
        'api.internal.example expires in three days.',
        'warning',
        'certificate',
        'certificate-mark-all-read-1',
        false,
        NOW() - INTERVAL '15 minutes'
      ),
      (
        'notification-mark-all-read-2',
        ${orgId},
        ${userId},
        'Agent heartbeat missed',
        'worker-01 has not checked in recently.',
        'critical',
        'host',
        'host-mark-all-read-2',
        false,
        NOW() - INTERVAL '8 minutes'
      ),
      (
        'notification-mark-all-read-3',
        ${orgId},
        ${userId},
        'Inventory completed',
        'The overnight inventory sync finished successfully.',
        'info',
        'host',
        'host-mark-all-read-3',
        true,
        NOW() - INTERVAL '2 minutes'
      )
  `

  await page.goto('/notifications')

  await expect(page.getByTestId('notifications-heading')).toBeVisible()
  await expect(page.getByTestId('notifications-tab-unread')).toContainText('2')

  await page.getByRole('button', { name: 'Mark all read' }).click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ id: string; read: boolean }>>`
        SELECT id, read
        FROM notifications
        WHERE id IN (
          'notification-mark-all-read-1',
          'notification-mark-all-read-2',
          'notification-mark-all-read-3'
        )
        ORDER BY id ASC
      `

      return rows
    })
    .toEqual([
      { id: 'notification-mark-all-read-1', read: true },
      { id: 'notification-mark-all-read-2', read: true },
      { id: 'notification-mark-all-read-3', read: true },
    ])

  await page.getByTestId('notifications-tab-unread').click()
  await expect(page.getByText('No unread notifications')).toBeVisible()
})

test('authenticated user can mark selected read notifications as unread', async ({ authenticatedPage: page }) => {
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
        'notification-mark-unread-1',
        ${orgId},
        ${userId},
        'Patch window completed',
        'The scheduled patch run completed successfully.',
        'info',
        'host',
        'host-mark-unread-1',
        true,
        NOW() - INTERVAL '20 minutes'
      ),
      (
        'notification-mark-unread-2',
        ${orgId},
        ${userId},
        'Certificate inventory refreshed',
        'A certificate scan refreshed the inventory.',
        'warning',
        'certificate',
        'certificate-mark-unread-2',
        true,
        NOW() - INTERVAL '12 minutes'
      ),
      (
        'notification-mark-unread-3',
        ${orgId},
        ${userId},
        'Agent check-in recovered',
        'worker-02 is reporting normally again.',
        'info',
        'host',
        'host-mark-unread-3',
        false,
        NOW() - INTERVAL '3 minutes'
      )
  `

  await page.goto('/notifications')

  await expect(page.getByTestId('notification-card-notification-mark-unread-1')).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-mark-unread-2')).toBeVisible()

  await page
    .getByTestId('notification-card-notification-mark-unread-1')
    .getByRole('checkbox')
    .click()
  await page
    .getByTestId('notification-card-notification-mark-unread-2')
    .getByRole('checkbox')
    .click()
  await page.getByTestId('notifications-bulk-mark-unread').click()

  await expect(page.getByTestId('notifications-tab-unread')).toContainText('3')
  await page.getByTestId('notifications-tab-unread').click()
  await expect(page.getByTestId('notification-card-notification-mark-unread-1')).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-mark-unread-2')).toBeVisible()
  await expect(page.getByTestId('notification-card-notification-mark-unread-3')).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ id: string; read: boolean }>>`
        SELECT id, read
        FROM notifications
        WHERE id IN (
          'notification-mark-unread-1',
          'notification-mark-unread-2',
          'notification-mark-unread-3'
        )
        ORDER BY id ASC
      `

      return rows
    })
    .toEqual([
      { id: 'notification-mark-unread-1', read: false },
      { id: 'notification-mark-unread-2', read: false },
      { id: 'notification-mark-unread-3', read: false },
    ])
})

test('authenticated user can expand a notification, change its read state, and delete it', async ({ authenticatedPage: page }) => {
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
    VALUES (
      'notification-row-actions-1',
      ${orgId},
      ${userId},
      'Review the host details',
      'The host detail page has new inventory data ready to review.',
      'info',
      'host',
      'host-row-actions-1',
      true,
      NOW() - INTERVAL '4 minutes'
    )
  `

  await page.goto('/notifications')

  const notificationCard = page.getByTestId('notification-card-notification-row-actions-1')
  await expect(notificationCard).toBeVisible()

  await notificationCard.getByText('Review the host details').click()
  await expect(page.getByTestId('notification-detail-notification-row-actions-1')).toContainText(
    'The host detail page has new inventory data ready to review.',
  )

  await page.getByTestId('notification-mark-unread-notification-row-actions-1').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ read: boolean }>>`
        SELECT read
        FROM notifications
        WHERE id = 'notification-row-actions-1'
        LIMIT 1
      `
      return rows[0]?.read ?? null
    })
    .toBe(false)

  await expect(page.getByTestId('notifications-tab-unread')).toContainText('1')

  await page.getByTestId('notification-mark-read-notification-row-actions-1').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ read: boolean }>>`
        SELECT read
        FROM notifications
        WHERE id = 'notification-row-actions-1'
        LIMIT 1
      `
      return rows[0]?.read ?? null
    })
    .toBe(true)

  await page.getByTestId('notification-delete-notification-row-actions-1').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM notifications
        WHERE id = 'notification-row-actions-1'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .toEqual(expect.any(Date))

  await expect(page.getByTestId('notification-card-notification-row-actions-1')).toHaveCount(0)
})
