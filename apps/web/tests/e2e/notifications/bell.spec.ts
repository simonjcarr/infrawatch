import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE, TEST_USER } from '../fixtures/seed'

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

test('authenticated user can review topbar notifications and open the linked resource', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { instanceId, userId } = await getInstanceAndUserIds(sql)

  await sql`
    INSERT INTO hosts (
      id,
      instance_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status,
      last_seen_at
    )
    VALUES (
      'notification-bell-host-1',
      ${instanceId},
      'notification-bell-host-1',
      'Notification Bell Host',
      'Ubuntu 24.04',
      'x86_64',
      '["10.70.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await sql`
    INSERT INTO notifications (
      id,
      instance_id,
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
        'notification-bell-unread-host',
        ${instanceId},
        ${userId},
        'Host needs attention',
        'Notification Bell Host missed a recent heartbeat.',
        'warning',
        'host',
        'notification-bell-host-1',
        false,
        NOW() - INTERVAL '3 minutes'
      ),
      (
        'notification-bell-unread-certificate',
        ${instanceId},
        ${userId},
        'Certificate expires soon',
        'edge.example.com expires in five days.',
        'critical',
        'certificate',
        'certificate-bell-1',
        false,
        NOW() - INTERVAL '2 minutes'
      )
  `

  await page.goto('/dashboard')

  await expect(page.getByTestId('notification-bell-trigger')).toBeVisible()
  await expect(page.getByTestId('notification-bell-unread-count')).toHaveText('2')

  await page.getByTestId('notification-bell-trigger').click()
  await expect(page.getByTestId('notification-bell-item-notification-bell-unread-host')).toContainText('Host needs attention')
  await expect(page.getByTestId('notification-bell-item-notification-bell-unread-certificate')).toContainText('Certificate expires soon')

  await page.getByTestId('notification-bell-item-notification-bell-unread-host').click()

  await expect(page).toHaveURL(/\/hosts\/notification-bell-host-1$/)
  await expect(page.getByRole('heading', { name: 'Notification Bell Host' })).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ read: boolean }>>`
        SELECT read
        FROM notifications
        WHERE id = 'notification-bell-unread-host'
        LIMIT 1
      `
      return rows[0]?.read ?? null
    })
    .toBe(true)
})
