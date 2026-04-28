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

test('host infrastructure tab shows patch status for the selected host', async ({ authenticatedPage: page }) => {
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

  await page.goto('/hosts/patch-host-1')
  await page.getByRole('button', { name: 'Infrastructure' }).click()
  await page.getByRole('button', { name: 'Patch Status' }).click()

  await expect(page.getByTestId('host-patch-status-tab')).toBeVisible()
  await expect(page.getByText('45 days')).toBeVisible()
  await expect(page.getByText('2 updates available')).toBeVisible()
  await expect(page.getByText('openssl')).toBeVisible()
  await expect(page.getByText('libssl3')).toBeVisible()
})
