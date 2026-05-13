import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'

async function getInstanceId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

async function seedHost(sql: ReturnType<typeof getTestDb>, instanceId: string, hostId: string) {
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
      ${hostId},
      ${instanceId},
      ${`${hostId}.example.test`},
      ${`Docker ${hostId}`},
      'Ubuntu 24.04',
      'x86_64',
      '["10.80.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `
}

test('host overview shows unknown Docker status for older agents', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  await seedHost(sql, instanceId, 'docker-status-unknown')

  await page.goto('/hosts/docker-status-unknown')

  const card = page.getByTestId('host-docker-status-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Unknown')
  await expect(card).toContainText('No Docker status has been reported yet.')
})

test('host overview shows installed Docker status with version details', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  await seedHost(sql, instanceId, 'docker-status-installed')

  await sql`
    INSERT INTO host_docker_status (
      instance_id,
      host_id,
      status,
      checked_at,
      runtime_version,
      api_version
    )
    VALUES (
      ${instanceId},
      'docker-status-installed',
      'installed',
      NOW() - INTERVAL '2 minutes',
      '25.0.5',
      '1.45'
    )
  `

  await page.goto('/hosts/docker-status-installed')

  const card = page.getByTestId('host-docker-status-card')
  await expect(card).toContainText('Installed')
  await expect(card).toContainText('Runtime 25.0.5')
  await expect(card).toContainText('API 1.45')
  await expect(card).toContainText('Last checked')
})

test('host overview distinguishes Docker permission denied from not installed', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  await seedHost(sql, instanceId, 'docker-status-denied')
  await seedHost(sql, instanceId, 'docker-status-missing')

  await sql`
    INSERT INTO host_docker_status (
      instance_id,
      host_id,
      status,
      checked_at,
      error_message
    )
    VALUES
      (
        ${instanceId},
        'docker-status-denied',
        'permission_denied',
        NOW() - INTERVAL '5 minutes',
        'Docker socket access denied'
      ),
      (
        ${instanceId},
        'docker-status-missing',
        'not_installed',
        NOW() - INTERVAL '7 minutes',
        NULL
      )
  `

  await page.goto('/hosts/docker-status-denied')
  const deniedCard = page.getByTestId('host-docker-status-card')
  await expect(deniedCard).toContainText('Permission denied')
  await expect(deniedCard).toContainText('Docker socket access denied')

  await page.goto('/hosts/docker-status-missing')
  const missingCard = page.getByTestId('host-docker-status-card')
  await expect(missingCard).toContainText('Not installed')
  await expect(missingCard).toContainText('Docker Engine is not installed or was not found.')
  await expect(missingCard).not.toContainText('Permission denied')
})
