import { test, expect } from '../fixtures/test'

test('authenticated user sees the LDAP setup empty state when no directory is configured', async ({ authenticatedPage: page }) => {
  await page.goto('/directory-lookup')

  await expect(page.getByTestId('directory-lookup-heading')).toContainText('Directory User Lookup')
  await expect(page.getByTestId('directory-lookup-empty-state')).toBeVisible()
  await expect(page.getByTestId('directory-lookup-empty-state')).toContainText('No directory configured')

  const configureLink = page.getByTestId('directory-lookup-configure-link')
  await expect(configureLink).toHaveAttribute('href', '/settings/integrations')

  await configureLink.click()
  await expect(page).toHaveURL(/\/settings\/integrations$/)
  await expect(page.getByTestId('ldap-settings-heading')).toBeVisible()
})
