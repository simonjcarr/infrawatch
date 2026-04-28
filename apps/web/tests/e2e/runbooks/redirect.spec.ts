import { test, expect } from '../fixtures/test'

test('authenticated user is redirected from runbooks to build docs', async ({ authenticatedPage: page }) => {
  await page.goto('/runbooks')

  await expect(page).toHaveURL(/\/build-docs$/)
  await expect(page.getByTestId('build-docs-heading')).toBeVisible()
})
