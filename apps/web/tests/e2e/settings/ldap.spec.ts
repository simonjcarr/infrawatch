import { test, expect } from '../fixtures/test'
import type { Page } from '@playwright/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'

const FIRST_EDIT_CA = '-----BEGIN CERTIFICATE-----\nFIRST_EDIT_CA\n-----END CERTIFICATE-----'
const REPLACEMENT_EDIT_CA = '-----BEGIN CERTIFICATE-----\nREPLACEMENT_EDIT_CA\n-----END CERTIFICATE-----'

async function getInstanceId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM instance_settings WHERE slug = ${TEST_INSTANCE.slug} LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

async function expectLdapDialogWide(page: Page): Promise<void> {
  const dialog = page.locator('[data-slot="dialog-content"]').first()
  await expect(dialog).toBeVisible()

  const box = await dialog.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(640)
}

test('admin can create, edit, toggle, and delete an LDAP configuration', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)

  await page.goto('/settings/integrations')

  await expect(page.getByTestId('ldap-settings-heading')).toBeVisible()
  await expect(page.getByTestId('ldap-settings-empty-state')).toBeVisible()

  await page.getByTestId('ldap-settings-add-open').click()
  await expectLdapDialogWide(page)
  await expect(page.getByTestId('ldap-settings-add-host')).toHaveAttribute('placeholder', 'dc01.corp.example.com')
  await expect(page.getByTestId('ldap-settings-add-base-dn')).toHaveAttribute('placeholder', 'DC=corp,DC=example,DC=com')
  await expect(page.getByTestId('ldap-settings-add-bind-dn')).toHaveAttribute('placeholder', 'CN=svc-ldap,OU=Service Accounts,DC=corp,DC=example,DC=com')
  await page.getByTestId('ldap-settings-add-name').fill('Corporate AD')
  await page.getByTestId('ldap-settings-add-host').fill('ldap.internal.example')
  await page.getByTestId('ldap-settings-add-base-dn').fill('DC=internal,DC=example')
  await page.getByTestId('ldap-settings-add-bind-dn').fill('CN=svc-ldap,DC=internal,DC=example')
  await page.getByTestId('ldap-settings-add-bind-password').fill('SuperSecret123!')
  await expect(page.getByTestId('ldap-settings-add-user-filter')).toHaveValue('(sAMAccountName={{username}})')
  await expect(page.getByTestId('ldap-settings-add-username-attribute')).toHaveValue('sAMAccountName')
  await page.getByTestId('ldap-settings-add-user-search-base').fill('ou=Staff')
  await page.getByTestId('ldap-settings-add-group-search-base').fill('ou=Security Groups')
  await page.getByTestId('ldap-settings-add-group-filter').fill('(objectClass=group)')
  await page.getByTestId('ldap-settings-add-submit').click()
  await expect(page.getByText('Corporate AD')).toBeVisible()

  const createdRows = await sql<Array<{
    id: string
    host: string
    port: number
    user_search_base: string | null
    user_search_filter: string
    group_search_base: string | null
    group_search_filter: string | null
    username_attribute: string
    email_attribute: string
    display_name_attribute: string
    allow_login: boolean
    enabled: boolean
    deleted_at: string | null
  }>>`
    SELECT
      id,
      host,
      port,
      user_search_base,
      user_search_filter,
      group_search_base,
      group_search_filter,
      username_attribute,
      email_attribute,
      display_name_attribute,
      allow_login,
      enabled,
      deleted_at
    FROM ldap_configurations
    WHERE instance_id = ${instanceId}
      AND name = 'Corporate AD'
    LIMIT 1
  `

  expect(createdRows).toHaveLength(1)
  expect(createdRows[0]?.host).toBe('ldap.internal.example')
  expect(createdRows[0]?.port).toBe(389)
  expect(createdRows[0]?.user_search_base).toBe('ou=Staff')
  expect(createdRows[0]?.user_search_filter).toBe('(sAMAccountName={{username}})')
  expect(createdRows[0]?.group_search_base).toBe('ou=Security Groups')
  expect(createdRows[0]?.group_search_filter).toBe('(objectClass=group)')
  expect(createdRows[0]?.username_attribute).toBe('sAMAccountName')
  expect(createdRows[0]?.email_attribute).toBe('mail')
  expect(createdRows[0]?.display_name_attribute).toBe('displayName')
  expect(createdRows[0]?.allow_login).toBe(false)
  expect(createdRows[0]?.enabled).toBe(true)
  expect(createdRows[0]?.deleted_at).toBeNull()

  const configId = createdRows[0]!.id
  const configRow = page.getByTestId(`ldap-config-row-${configId}`)

  await expect(configRow).toBeVisible()
  await expect(configRow).toContainText('Corporate AD')
  await expect(configRow).toContainText('ldap://ldap.internal.example:389')

  await page.getByTestId(`ldap-config-edit-${configId}`).click()
  await expectLdapDialogWide(page)
  await page.getByTestId('ldap-settings-edit-use-tls').click()
  await page.getByTestId('ldap-settings-edit-ca-file').setInputFiles({
    name: 'first-edit-ca.pem',
    mimeType: 'application/x-pem-file',
    buffer: Buffer.from(FIRST_EDIT_CA),
  })
  await expect(page.getByTestId('ldap-settings-edit-ca-preview')).toContainText('FIRST_EDIT_CA')
  await page.getByTestId('ldap-settings-edit-host').fill('directory.internal.example')
  await page.getByTestId('ldap-settings-edit-port').fill('636')
  await page.getByTestId('ldap-settings-edit-user-filter').fill('(mail={{username}})')
  await page.getByTestId('ldap-settings-edit-save').click()

  await expect(configRow).toContainText('ldaps://directory.internal.example:636')
  await expect(configRow).toContainText('(mail={{username}})')

  await page.getByTestId(`ldap-config-edit-${configId}`).click()
  await expect(page.getByTestId('ldap-settings-edit-ca-preview')).toContainText('FIRST_EDIT_CA')
  await expect(page.getByRole('button', { name: 'Replace Certificate (.pem, .crt)' })).toBeVisible()
  await page.getByTestId('ldap-settings-edit-ca-file').setInputFiles({
    name: 'replacement-edit-ca.pem',
    mimeType: 'application/x-pem-file',
    buffer: Buffer.from(REPLACEMENT_EDIT_CA),
  })
  await expect(page.getByTestId('ldap-settings-edit-ca-preview')).toContainText('REPLACEMENT_EDIT_CA')
  await page.getByTestId('ldap-settings-edit-save').click()

  await page.getByTestId(`ldap-config-edit-${configId}`).click()
  await expect(page.getByTestId('ldap-settings-edit-ca-preview')).toContainText('REPLACEMENT_EDIT_CA')
  await expect(page.getByTestId('ldap-settings-edit-ca-preview')).not.toContainText('FIRST_EDIT_CA')
  await page.keyboard.press('Escape')

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
