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

test('authenticated user can review topbar notifications and open the linked resource', async ({ authenticatedPage: page }) => {
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
      'notification-bell-host-1',
      ${orgId},
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
        'notification-bell-unread-host',
        ${orgId},
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
        ${orgId},
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
