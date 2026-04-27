import { test, expect } from '../fixtures/test'

test('authenticated user visiting login is redirected to the dashboard', async ({ authenticatedPage: page }) => {
  await page.goto('/login')

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
})
