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

test('authenticated user sees the LDAP setup empty state when no directory is configured', async ({ authenticatedPage: page }) => {
  await page.goto('/directory-lookup')

  await expect(page.getByTestId('directory-lookup-heading')).toContainText('Directory User Lookup')
  await expect(page.getByTestId('directory-lookup-empty-state')).toBeVisible()
  await expect(page.getByTestId('directory-lookup-empty-state')).toContainText('No directory configured')
  await expect(page.getByTestId('directory-lookup-empty-description')).toContainText(
    'Add an LDAP or Active Directory configuration to enable directory lookups.',
  )

  const configureLink = page.getByTestId('directory-lookup-configure-link')
  await expect(configureLink).toHaveAttribute('href', '/settings/integrations')

  await configureLink.click()
  await expect(page).toHaveURL(/\/settings\/integrations$/)
  await expect(page.getByTestId('ldap-settings-heading')).toBeVisible()
})

test('authenticated user can access the directory lookup UI when enabled LDAP configs exist', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  await sql`
    INSERT INTO ldap_configurations (
      id,
      organisation_id,
      name,
      host,
      port,
      base_dn,
      bind_dn,
      bind_password,
      enabled,
      deleted_at
    )
    VALUES
      (
        'ldap-config-directory-primary',
        ${orgId},
        'Primary Directory',
        'ldap.primary.internal',
        389,
        'dc=primary,dc=internal',
        'cn=svc-primary,dc=primary,dc=internal',
        'SuperSecret123!',
        true,
        NULL
      ),
      (
        'ldap-config-directory-secondary',
        ${orgId},
        'Secondary Directory',
        'ldap.secondary.internal',
        636,
        'dc=secondary,dc=internal',
        'cn=svc-secondary,dc=secondary,dc=internal',
        'AnotherSecret123!',
        true,
        NULL
      ),
      (
        'ldap-config-directory-disabled',
        ${orgId},
        'Disabled Directory',
        'ldap.disabled.internal',
        389,
        'dc=disabled,dc=internal',
        'cn=svc-disabled,dc=disabled,dc=internal',
        'DisabledSecret123!',
        false,
        NULL
      ),
      (
        'ldap-config-directory-deleted',
        ${orgId},
        'Deleted Directory',
        'ldap.deleted.internal',
        389,
        'dc=deleted,dc=internal',
        'cn=svc-deleted,dc=deleted,dc=internal',
        'DeletedSecret123!',
        true,
        NOW()
      )
  `

  await page.goto('/directory-lookup')

  await expect(page.getByTestId('directory-lookup-heading')).toContainText('Directory User Lookup')
  await expect(page.getByTestId('directory-lookup-empty-state')).toHaveCount(0)
  await expect(page.getByTestId('directory-lookup-query-input')).toBeVisible()

  const directorySelector = page.getByRole('combobox')
  await expect(directorySelector).toContainText('Primary Directory')

  await directorySelector.click()
  await expect(page.getByRole('option', { name: 'Primary Directory' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Secondary Directory' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Disabled Directory' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'Deleted Directory' })).toHaveCount(0)

  await page.getByRole('option', { name: 'Secondary Directory' }).click()
  await expect(directorySelector).toContainText('Secondary Directory')
  await expect(page.getByTestId('directory-lookup-query-input')).toHaveValue('')
})
