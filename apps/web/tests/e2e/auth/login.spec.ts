import { test, expect } from '../fixtures/test'
import { TEST_USER } from '../fixtures/seed'

test('user can sign in with email and password and reach the dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(TEST_USER.email)
  await page.getByTestId('login-password').fill(TEST_USER.password)
  await page.getByTestId('login-submit').click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
})

test('login form shows validation errors when submitted empty', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-submit').click()

  await expect(page.getByText('Enter a valid email address')).toBeVisible()
  await expect(page.getByText('Password is required')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})
