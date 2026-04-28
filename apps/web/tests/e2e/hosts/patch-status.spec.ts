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

test('host infrastructure tab shows network memberships and patch status for the selected host', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

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
      'patch-host-1',
      ${orgId},
      'patch-node-1',
      'Patch Node 1',
      'Ubuntu 24.04',
      'x86_64',
      '["10.20.0.10"]'::jsonb,
      'online',
      NOW()
    )
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
      checked_at
    )
    VALUES (
      'patch-status-1',
      ${orgId},
      'patch-host-1',
      NULL,
      'fail',
      NOW() - INTERVAL '45 days',
      45,
      30,
      'apt',
      true,
      2,
      false,
      '[]'::jsonb,
      NOW()
    )
  `

  await sql`
    INSERT INTO host_package_updates (
      id,
      organisation_id,
      host_id,
      name,
      current_version,
      available_version,
      package_manager,
      status,
      first_seen_at,
      last_seen_at
    )
    VALUES
      ('patch-update-1', ${orgId}, 'patch-host-1', 'openssl', '3.0.2-1', '3.0.2-2', 'apt', 'current', NOW(), NOW()),
      ('patch-update-2', ${orgId}, 'patch-host-1', 'libssl3', '3.0.2-1', '3.0.2-2', 'apt', 'current', NOW(), NOW())
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
      ('network-auto-1', ${orgId}, 'Office LAN', '10.20.0.0/24', 'Auto-discovered office subnet'),
      ('network-manual-1', ${orgId}, 'DMZ', '10.30.0.0/24', 'Manually managed network')
  `

  await sql`
    INSERT INTO host_network_memberships (
      id,
      organisation_id,
      network_id,
      host_id,
      auto_assigned
    )
    VALUES (
      'membership-auto-1',
      ${orgId},
      'network-auto-1',
      'patch-host-1',
      true
    )
  `

  await page.goto('/hosts/patch-host-1')
  await page.getByRole('button', { name: 'Infrastructure' }).click()
  await page.getByRole('button', { name: 'Networks' }).click()

  await expect(page.getByTestId('host-networks-tab')).toBeVisible()
  await expect(page.getByTestId('host-network-row-network-auto-1')).toContainText('Office LAN')
  await expect(page.getByTestId('host-network-membership-network-auto-1')).toContainText('Auto')

  await page.getByTestId('host-networks-add-trigger').click()
  await page.getByTestId('host-networks-add-network-manual-1').click()

  await expect(page.getByTestId('host-network-row-network-manual-1')).toContainText('DMZ')
  await expect(page.getByTestId('host-network-membership-network-manual-1')).toContainText('Manual')

  await page.getByTestId('host-networks-remove-network-manual-1').click()
  await expect(page.getByTestId('host-network-row-network-manual-1')).toHaveCount(0)

  await page.getByRole('button', { name: 'Patch Status' }).click()

  await expect(page.getByTestId('host-patch-status-tab')).toBeVisible()
  await expect(page.getByText('45 days')).toBeVisible()
  await expect(page.getByText('2 updates available')).toBeVisible()
  await expect(page.getByText('openssl')).toBeVisible()
  await expect(page.getByText('libssl3')).toBeVisible()

  const membershipRows = await sql<Array<{ deleted_at: string | null }>>`
    SELECT deleted_at
    FROM host_network_memberships
    WHERE network_id = 'network-manual-1'
      AND host_id = 'patch-host-1'
    LIMIT 1
  `

  expect(membershipRows).toHaveLength(1)
  expect(membershipRows[0]?.deleted_at).not.toBeNull()
})
