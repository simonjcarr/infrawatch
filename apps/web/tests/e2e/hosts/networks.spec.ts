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

test('admin can create, edit, and delete a network and manage its hosts', async ({ authenticatedPage: page }) => {
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
    VALUES
      (
        'network-host-1',
        ${orgId},
        'edge-node-1',
        'Edge Node 1',
        'Ubuntu 24.04',
        'x86_64',
        '["10.55.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'network-host-2',
        ${orgId},
        'edge-node-2',
        'Edge Node 2',
        'Ubuntu 24.04',
        'arm64',
        '["10.55.0.11"]'::jsonb,
        'offline',
        NOW() - INTERVAL '2 hours'
      )
  `

  await page.goto('/hosts/networks')

  await expect(page.getByTestId('networks-heading')).toBeVisible()
  await expect(page.getByTestId('networks-empty-state')).toBeVisible()

  await page.getByTestId('networks-create-open').click()
  await page.getByLabel('Name').fill('Branch Office')
  await page.getByLabel('CIDR').fill('10.55.0.0/24')
  await page.getByLabel('Description (optional)').fill('Branch office LAN')
  await page.getByTestId('networks-create-submit').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ id: string | null }>>`
        SELECT id
        FROM networks
        WHERE organisation_id = ${orgId}
          AND name = 'Branch Office'
          AND deleted_at IS NULL
        LIMIT 1
      `

      return rows[0]?.id ?? null
    })
    .not.toBeNull()

  const createdRows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM networks
    WHERE organisation_id = ${orgId}
      AND name = 'Branch Office'
      AND deleted_at IS NULL
    LIMIT 1
  `

  expect(createdRows).toHaveLength(1)
  const networkId = createdRows[0]!.id
  const networkRow = page.getByTestId(`network-row-${networkId}`)
  await expect(networkRow).toContainText('Branch Office')
  await expect(networkRow).toContainText('10.55.0.0/24')
  await expect(networkRow).toContainText('Branch office LAN')

  await page.getByTestId('networks-view-graph').click()
  await expect(page.getByTestId('networks-graph')).toBeVisible()
  await expect(page.getByText('Branch Office')).toBeVisible()

  await page.getByTestId('networks-view-table').click()
  await expect(networkRow).toBeVisible()

  await networkRow.getByRole('link', { name: 'Branch Office' }).click()

  await expect(page).toHaveURL(new RegExp(`/hosts/networks/${networkId}$`))
  await expect(page.getByTestId('network-detail-heading')).toContainText('Branch Office')
  await expect(page.getByTestId('network-detail-empty-state')).toBeVisible()

  await page.getByTestId('network-detail-add-open').click()
  await page.getByTestId('network-detail-add-search').fill('edge-node-1')
  await page.getByTestId('network-detail-add-network-host-1').click()

  const memberRow = page.getByTestId('network-detail-member-network-host-1')
  await expect(memberRow).toContainText('Edge Node 1')
  await expect(memberRow).toContainText('online')
  await expect(page.getByTestId('network-detail-empty-state')).toHaveCount(0)

  await page.getByTestId('network-detail-view-graph').click()
  const detailGraph = page.getByTestId('network-detail-graph')
  await expect(detailGraph).toBeVisible()
  await expect(detailGraph.getByText('Branch Office')).toBeVisible()
  await expect(detailGraph.getByText('Edge Node 1')).toBeVisible()

  await page.getByTestId('network-detail-view-table').click()
  await expect(memberRow).toBeVisible()

  const membershipRows = await sql<Array<{ deleted_at: string | null; auto_assigned: boolean }>>`
    SELECT deleted_at, auto_assigned
    FROM host_network_memberships
    WHERE organisation_id = ${orgId}
      AND network_id = ${networkId}
      AND host_id = 'network-host-1'
    LIMIT 1
  `

  expect(membershipRows).toEqual([
    {
      deleted_at: null,
      auto_assigned: false,
    },
  ])

  await page.getByTestId(`network-detail-remove-network-host-1`).click()
  await page.getByTestId('network-detail-remove-confirm').click()

  await expect(memberRow).toHaveCount(0)
  await expect(page.getByTestId('network-detail-empty-state')).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: string | null }>>`
        SELECT deleted_at
        FROM host_network_memberships
        WHERE organisation_id = ${orgId}
          AND network_id = ${networkId}
          AND host_id = 'network-host-1'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .not.toBeNull()

  await page.goto('/hosts/networks')

  await page.getByTestId(`network-edit-${networkId}`).click()
  await page.getByLabel('Name').fill('Branch Office Updated')
  await page.getByLabel('CIDR').fill('10.55.1.0/24')
  await page.getByLabel('Description (optional)').fill('Updated branch office LAN')
  await page.getByTestId('networks-edit-submit').click()

  const updatedRow = page.getByTestId(`network-row-${networkId}`)
  await expect(updatedRow).toContainText('Branch Office Updated')
  await expect(updatedRow).toContainText('10.55.1.0/24')
  await expect(updatedRow).toContainText('Updated branch office LAN')

  await page.getByTestId(`network-delete-${networkId}`).click()
  await page.getByTestId('network-delete-confirm').click()

  await expect(updatedRow).toHaveCount(0)
  await expect(page.getByTestId('networks-empty-state')).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: string | null }>>`
        SELECT deleted_at
        FROM networks
        WHERE id = ${networkId}
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .not.toBeNull()
})
