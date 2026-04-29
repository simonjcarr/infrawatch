import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('authenticated user can manage group and network memberships from the host detail page', async ({ authenticatedPage: page }) => {
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
      'membership-host-1',
      ${orgId},
      'ops-node-01',
      'Ops Node 01',
      'Ubuntu 24.04',
      'x86_64',
      '["10.70.0.10"]'::jsonb,
      'online',
      NOW()
    )
  `

  await sql`
    INSERT INTO host_groups (
      id,
      organisation_id,
      name,
      description
    )
    VALUES (
      'membership-group-1',
      ${orgId},
      'Canary Fleet',
      'Hosts staged for rollout validation'
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
    VALUES (
      'membership-network-1',
      ${orgId},
      'Ops LAN',
      '10.70.0.0/24',
      'Operations network'
    )
  `

  await page.goto('/hosts/membership-host-1')

  await expect(page.getByText('Ops Node 01')).toBeVisible()

  await page.getByTestId('host-parent-tab-management').click()
  await expect(page.getByTestId('host-groups-tab')).toBeVisible()
  await expect(page.getByText('Not in any groups')).toBeVisible()

  await page.getByTestId('host-groups-add-trigger').click()
  await page.getByTestId('host-groups-add-membership-group-1').click()

  const groupRow = page.getByTestId('host-group-row-membership-group-1')
  await expect(groupRow).toContainText('Canary Fleet')
  await expect(page.getByText('Not in any groups')).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: string | null }>>`
        SELECT deleted_at
        FROM host_group_members
        WHERE organisation_id = ${orgId}
          AND group_id = 'membership-group-1'
          AND host_id = 'membership-host-1'
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({ deleted_at: null })

  await page.getByTestId('host-groups-remove-membership-group-1').click()
  await expect(groupRow).toHaveCount(0)
  await expect(page.getByText('Not in any groups')).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: string | null }>>`
        SELECT deleted_at
        FROM host_group_members
        WHERE organisation_id = ${orgId}
          AND group_id = 'membership-group-1'
          AND host_id = 'membership-host-1'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .not.toBeNull()

  await page.getByTestId('host-parent-tab-infrastructure').click()
  await page.getByTestId('host-tab-host-networks').click()
  await expect(page.getByTestId('host-networks-tab')).toBeVisible()
  await expect(page.getByText('Not in any networks')).toBeVisible()

  await page.getByTestId('host-networks-add-trigger').click()
  await page.getByTestId('host-networks-add-membership-network-1').click()

  const networkRow = page.getByTestId('host-network-row-membership-network-1')
  await expect(networkRow).toContainText('Ops LAN')
  await expect(page.getByTestId('host-network-membership-membership-network-1')).toContainText('Manual')
  await expect(page.getByText('Not in any networks')).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: string | null; auto_assigned: boolean }>>`
        SELECT deleted_at, auto_assigned
        FROM host_network_memberships
        WHERE organisation_id = ${orgId}
          AND network_id = 'membership-network-1'
          AND host_id = 'membership-host-1'
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({ deleted_at: null, auto_assigned: false })

  await page.getByTestId('host-networks-remove-membership-network-1').click()
  await expect(networkRow).toHaveCount(0)
  await expect(page.getByText('Not in any networks')).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: string | null }>>`
        SELECT deleted_at
        FROM host_network_memberships
        WHERE organisation_id = ${orgId}
          AND network_id = 'membership-network-1'
          AND host_id = 'membership-host-1'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .not.toBeNull()
})
