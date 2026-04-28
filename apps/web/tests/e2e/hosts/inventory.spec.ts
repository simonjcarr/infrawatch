import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ orgId: string; userId: string }> {
  const rows = await sql<Array<{ org_id: string; user_id: string }>>`
    SELECT organisations.id AS org_id, "user".id AS user_id
    FROM organisations
    JOIN "user" ON "user".organisation_id = organisations.id
    WHERE organisations.slug = ${TEST_ORG.slug}
      AND "user".email = 'e2e@example.com'
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    orgId: rows[0]!.org_id,
    userId: rows[0]!.user_id,
  }
}

test('authenticated user can search and filter the host inventory', async ({ authenticatedPage: page }) => {
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
      cpu_percent,
      memory_percent,
      disk_percent,
      last_seen_at
    )
    VALUES
      (
        'host-alpha',
        ${orgId},
        'alpha-node',
        'Alpha Node',
        'Ubuntu 24.04',
        'x86_64',
        '["10.0.0.10"]'::jsonb,
        'online',
        15,
        20,
        25,
        NOW()
      ),
      (
        'host-beta',
        ${orgId},
        'beta-node',
        'Beta Node',
        'Windows 11',
        'x86_64',
        '["10.0.0.20"]'::jsonb,
        'offline',
        35,
        40,
        45,
        NOW() - INTERVAL '2 hours'
      )
  `

  await page.goto('/hosts')

  await expect(page.getByTestId('hosts-heading')).toBeVisible()
  await expect(page.getByText('2 hosts registered')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()

  await page.getByTestId('hosts-search-input').fill('10.0.0.20')
  await expect(page.getByText('Showing 1–1 of 1')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toHaveCount(0)
  await expect(page.getByTestId('hosts-clear-filters')).toBeVisible()

  await page.getByTestId('hosts-clear-filters').click()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()

  await page.getByTestId('hosts-status-filter').click()
  await page.getByRole('option', { name: 'Offline' }).click()

  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha Node' })).toHaveCount(0)

  await page.getByTestId('hosts-os-filter').click()
  await page.getByRole('option', { name: 'Windows 11' }).click()

  await expect(page.getByRole('link', { name: 'Beta Node' })).toBeVisible()
  await expect(page.getByText('Showing 1–1 of 1')).toBeVisible()
})

test('admin can approve a pending agent from the host inventory page', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    INSERT INTO agents (
      id,
      organisation_id,
      hostname,
      public_key,
      status,
      os,
      arch
    )
    VALUES (
      'pending-agent-1',
      ${orgId},
      'pending-node',
      'pending-public-key-1',
      'pending',
      'Ubuntu 24.04',
      'arm64'
    )
  `

  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      agent_id,
      hostname,
      display_name,
      os,
      arch,
      ip_addresses,
      status
    )
    VALUES (
      'pending-host-1',
      ${orgId},
      'pending-agent-1',
      'pending-node',
      'Pending Node',
      'Ubuntu 24.04',
      'arm64',
      '["10.0.1.50"]'::jsonb,
      'unknown'
    )
  `

  await page.goto('/hosts')

  await expect(page.getByTestId('pending-agent-approvals')).toBeVisible()
  await expect(page.getByTestId('pending-agent-row-pending-agent-1')).toContainText('pending-node')
  await expect(page.getByText('Pending approval')).toBeVisible()

  await page.getByTestId('pending-agent-approve-pending-agent-1').click()

  await expect(page.getByTestId('pending-agent-approvals')).toHaveCount(0)

  const agentRows = await sql<Array<{ status: string; approved_by_id: string | null }>>`
    SELECT status, approved_by_id
    FROM agents
    WHERE id = 'pending-agent-1'
    LIMIT 1
  `

  expect(agentRows).toHaveLength(1)
  expect(agentRows[0]?.status).toBe('active')
  expect(agentRows[0]?.approved_by_id).toBe(userId)
})
