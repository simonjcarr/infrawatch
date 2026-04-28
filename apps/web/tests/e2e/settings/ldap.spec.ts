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

test('admin can create, edit, toggle, and delete an LDAP configuration', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  await page.goto('/settings/integrations')

  await expect(page.getByTestId('ldap-settings-heading')).toBeVisible()
  await expect(page.getByTestId('ldap-settings-empty-state')).toBeVisible()

  await page.getByTestId('ldap-settings-add-open').click()
  await page.getByTestId('ldap-settings-add-name').fill('Corporate AD')
  await page.getByTestId('ldap-settings-add-host').fill('ldap.internal.example')
  await page.getByTestId('ldap-settings-add-base-dn').fill('dc=internal,dc=example')
  await page.getByTestId('ldap-settings-add-bind-dn').fill('cn=svc-ldap,dc=internal,dc=example')
  await page.getByTestId('ldap-settings-add-bind-password').fill('SuperSecret123!')
  await page.getByTestId('ldap-settings-add-submit').click()
  await expect(page.getByText('Corporate AD')).toBeVisible()

  const createdRows = await sql<Array<{
    id: string
    host: string
    port: number
    allow_login: boolean
    enabled: boolean
    deleted_at: string | null
  }>>`
    SELECT id, host, port, allow_login, enabled, deleted_at
    FROM ldap_configurations
    WHERE organisation_id = ${orgId}
      AND name = 'Corporate AD'
    LIMIT 1
  `

  expect(createdRows).toHaveLength(1)
  expect(createdRows[0]?.host).toBe('ldap.internal.example')
  expect(createdRows[0]?.port).toBe(389)
  expect(createdRows[0]?.allow_login).toBe(false)
  expect(createdRows[0]?.enabled).toBe(true)
  expect(createdRows[0]?.deleted_at).toBeNull()

  const configId = createdRows[0]!.id
  const configRow = page.getByTestId(`ldap-config-row-${configId}`)

  await expect(configRow).toBeVisible()
  await expect(configRow).toContainText('Corporate AD')
  await expect(configRow).toContainText('ldap://ldap.internal.example:389')

  await page.getByTestId(`ldap-config-edit-${configId}`).click()
  await page.getByTestId('ldap-settings-edit-host').fill('directory.internal.example')
  await page.getByTestId('ldap-settings-edit-port').fill('636')
  await page.getByTestId('ldap-settings-edit-user-filter').fill('(mail={{username}})')
  await page.getByTestId('ldap-settings-edit-save').click()

  await expect(configRow).toContainText('ldap://directory.internal.example:636')
  await expect(configRow).toContainText('(mail={{username}})')

  await page.getByTestId(`ldap-config-enabled-${configId}`).click()
  await expect(configRow).toContainText('Disabled')

  await page.getByTestId(`ldap-config-allow-login-${configId}`).click()

  await expect.poll(async () => {
    const rows = await sql<Array<{
      host: string
      port: number
      user_search_filter: string
      allow_login: boolean
      enabled: boolean
    }>>`
      SELECT host, port, user_search_filter, allow_login, enabled
      FROM ldap_configurations
      WHERE id = ${configId}
      LIMIT 1
    `

    return rows[0] ?? null
  }).toMatchObject({
    host: 'directory.internal.example',
    port: 636,
    user_search_filter: '(mail={{username}})',
    allow_login: true,
    enabled: false,
  })

  await page.getByTestId(`ldap-config-delete-${configId}`).click()

  await expect(configRow).toHaveCount(0)
  await expect(page.getByTestId('ldap-settings-empty-state')).toBeVisible()

  const deletedRows = await sql<Array<{ deleted_at: string | null }>>`
    SELECT deleted_at
    FROM ldap_configurations
    WHERE id = ${configId}
    LIMIT 1
  `

  expect(deletedRows).toHaveLength(1)
  expect(deletedRows[0]?.deleted_at).not.toBeNull()
})
