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

test('authenticated user can create, edit, and delete a host group', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  await page.goto('/hosts/groups')

  await expect(page.getByTestId('host-groups-heading')).toBeVisible()
  await expect(page.getByTestId('host-groups-empty-state')).toBeVisible()

  await page.getByTestId('host-groups-create-trigger').click()
  await page.getByTestId('host-groups-form-name').fill('Linux Servers')
  await page.getByTestId('host-groups-form-description').fill('Linux production fleet')
  await page.getByTestId('host-groups-create-submit').click()

  const initialRow = page.getByTestId('host-groups-row-linux-servers')
  await expect(initialRow).toBeVisible()
  await expect(initialRow).toContainText('Linux Servers')
  await expect(initialRow).toContainText('Linux production fleet')
  await expect(initialRow).toContainText('0')

  const createdRows = await sql<Array<{ id: string; deleted_at: string | null }>>`
    SELECT id, deleted_at
    FROM host_groups
    WHERE organisation_id = ${orgId}
      AND name = 'Linux Servers'
    LIMIT 1
  `

  expect(createdRows).toHaveLength(1)
  expect(createdRows[0]?.deleted_at).toBeNull()

  const groupId = createdRows[0]!.id

  await page.getByTestId(`host-groups-edit-${groupId}`).click()
  await page.getByTestId('host-groups-form-name').fill('Linux Estate')
  await page.getByTestId('host-groups-form-description').fill('Linux production and staging fleet')
  await page.getByTestId('host-groups-edit-submit').click()

  const updatedRow = page.getByTestId('host-groups-row-linux-estate')
  await expect(updatedRow).toBeVisible()
  await expect(updatedRow).toContainText('Linux production and staging fleet')

  await page.getByTestId(`host-groups-delete-${groupId}`).click()
  await page.getByTestId('host-groups-delete-confirm').click()

  await expect(updatedRow).toHaveCount(0)
  await expect(page.getByTestId('host-groups-empty-state')).toBeVisible()

  const deletedRows = await sql<Array<{ deleted_at: string | null }>>`
    SELECT deleted_at
    FROM host_groups
    WHERE id = ${groupId}
    LIMIT 1
  `

  expect(deletedRows).toHaveLength(1)
  expect(deletedRows[0]?.deleted_at).not.toBeNull()
})
