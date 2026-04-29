import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug} LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('patch status report shows organisation compliance by network and host', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      os_version,
      arch,
      ip_addresses,
      status,
      last_seen_at
    )
    VALUES
      (
        'patch-report-host-1',
        ${orgId},
        'db-01',
        'Database 01',
        'Ubuntu',
        '24.04',
        'x86_64',
        '["10.70.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'patch-report-host-2',
        ${orgId},
        'web-01',
        'Web 01',
        'Debian',
        '12',
        'x86_64',
        '["10.71.0.10"]'::jsonb,
        'online',
        NOW()
      )
  `

  await sql`
    INSERT INTO networks (
      id,
      organisation_id,
      name,
      cidr,
      description
    )
    VALUES
      ('patch-report-network-1', ${orgId}, 'Production', '10.70.0.0/24', 'Production subnet'),
      ('patch-report-network-2', ${orgId}, 'DMZ', '10.71.0.0/24', 'DMZ subnet')
  `

  await sql`
    INSERT INTO host_network_memberships (
      id,
      organisation_id,
      network_id,
      host_id,
      auto_assigned
    )
    VALUES
      ('patch-report-membership-1', ${orgId}, 'patch-report-network-1', 'patch-report-host-1', true),
      ('patch-report-membership-2', ${orgId}, 'patch-report-network-2', 'patch-report-host-2', false)
  `

  await sql`
    INSERT INTO host_patch_statuses (
      id,
      organisation_id,
      host_id,
      check_id,
      status,
      last_patched_at,
      patch_age_days,
      max_age_days,
      package_manager,
      updates_supported,
      updates_count,
      updates_truncated,
      warnings,
      error,
      checked_at
    )
    VALUES
      (
        'patch-report-status-1',
        ${orgId},
        'patch-report-host-1',
        NULL,
        'fail',
        NOW() - INTERVAL '45 days',
        45,
        30,
        'apt',
        true,
        3,
        false,
        '[]'::jsonb,
        NULL,
        NOW() - INTERVAL '5 minutes'
      ),
      (
        'patch-report-status-2',
        ${orgId},
        'patch-report-host-2',
        NULL,
        'pass',
        NOW() - INTERVAL '7 days',
        7,
        30,
        'apt',
        true,
        0,
        false,
        '[]'::jsonb,
        NULL,
        NOW() - INTERVAL '4 minutes'
      )
  `

  await page.goto('/reports/patch-status')

  await expect(page.getByTestId('patch-status-report-heading')).toBeVisible()
  await expect(page.getByTestId('patch-status-summary-compliance')).toContainText('50%')
  await expect(page.getByTestId('patch-status-summary-hosts')).toContainText('2')
  await expect(page.getByTestId('patch-status-summary-outside-policy')).toContainText('1')
  await expect(page.getByTestId('patch-status-summary-oldest-age')).toContainText('45d')
  await expect(page.getByTestId('patch-status-summary-updates')).toContainText('3')

  const productionRow = page.getByTestId('patch-status-network-row-patch-report-network-1')
  await expect(productionRow).toContainText('Production')
  await expect(productionRow).toContainText('1')
  await expect(productionRow).toContainText('0')
  await expect(productionRow).toContainText('45d')

  const dmzRow = page.getByTestId('patch-status-network-row-patch-report-network-2')
  await expect(dmzRow).toContainText('DMZ')
  await expect(dmzRow).toContainText('1')
  await expect(dmzRow).toContainText('1')
  await expect(dmzRow).toContainText('0')
  await expect(dmzRow).toContainText('7d')

  const failingHostRow = page.getByTestId('patch-status-host-row-patch-report-host-1')
  await expect(failingHostRow).toContainText('Database 01')
  await expect(failingHostRow).toContainText('Outside policy')
  await expect(failingHostRow).toContainText('Production')
  await expect(failingHostRow).toContainText('45d')
  await expect(failingHostRow).toContainText('30d')
  await expect(failingHostRow).toContainText('3')
  await expect(failingHostRow).toContainText('Ubuntu')

  const passingHostRow = page.getByTestId('patch-status-host-row-patch-report-host-2')
  await expect(passingHostRow).toContainText('Web 01')
  await expect(passingHostRow).toContainText('Within policy')
  await expect(passingHostRow).toContainText('DMZ')
  await expect(passingHostRow).toContainText('7d')
  await expect(passingHostRow).toContainText('0')
  await expect(passingHostRow).toContainText('Debian')
})
