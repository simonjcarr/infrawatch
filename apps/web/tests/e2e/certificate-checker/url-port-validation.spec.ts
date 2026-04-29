import { test, expect } from '../fixtures/test'

test('authenticated user sees a safe validation error for blocked certificate-checker ports', async ({ authenticatedPage: page }) => {
  await page.goto('/certificate-checker')

  await expect(page.getByTestId('certificate-checker-heading')).toBeVisible()
  await page.getByTestId('certificate-checker-tab-url').click()
  await page.getByTestId('certificate-checker-url-input').fill('https://example.com')
  await page.getByTestId('certificate-checker-port-input').fill('22')
  await page.getByTestId('certificate-checker-url-submit').click()

  await expect(page.getByTestId('certificate-checker-url-error')).toContainText(
    'Blocked: port 22 is not allowed. Use one of: 443, 465, 587, 636, 853, 993, 995, 8443, 9443',
  )
  await expect(page.getByTestId('certificate-checker-result')).toHaveCount(0)
  await expect(page.getByTestId('certificate-checker-empty-state')).toBeVisible()
})
