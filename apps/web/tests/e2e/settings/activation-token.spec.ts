import { test, expect } from '../fixtures/test'

test('admin can generate an activation token from settings', async ({ authenticatedPage: page }) => {
  await page.goto('/settings')

  await expect(page.getByTestId('settings-heading')).toBeVisible()
  await page.getByTestId('activation-token-generate').click()

  const activationToken = page.getByTestId('activation-token')
  await expect(activationToken).toBeVisible()
  await expect(activationToken).not.toBeEmpty()
  await expect(page.getByTestId('activation-token-generate')).toHaveText('Generate a new token')

  const firstToken = await activationToken.textContent()
  await page.getByTestId('activation-token-generate').click()
  await expect(activationToken).not.toHaveText(firstToken ?? '')
})
