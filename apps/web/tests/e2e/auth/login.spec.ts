import { test, expect } from '../fixtures/test'
import { waitForPasswordResetUrl } from '../fixtures/email'
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

test('user can request a password reset from the login screen and sign in with the new password', async ({
  page,
}) => {
  const newPassword = 'ResetPassword123!'

  await page.goto('/login')
  await expect(page.getByTestId('forgot-password-link')).toBeVisible()
  await page.getByTestId('forgot-password-link').click()

  await page.waitForURL('**/forgot-password')
  await page.getByTestId('forgot-password-email').fill(TEST_USER.email)
  await page.getByTestId('forgot-password-submit').click()

  await expect(page.getByTestId('forgot-password-success')).toContainText(
    'If an account exists for that email, we sent a password reset link.',
  )

  const resetUrl = await waitForPasswordResetUrl(TEST_USER.email)
  await page.goto(resetUrl)

  await page.getByTestId('reset-password-new-password').fill(newPassword)
  await page.getByTestId('reset-password-confirm-password').fill(newPassword)
  await page.getByTestId('reset-password-submit').click()

  await page.waitForURL('**/login?reset=1')
  await expect(page.getByTestId('login-notice')).toContainText('Your password has been reset.')

  await page.getByTestId('login-email').fill(TEST_USER.email)
  await page.getByTestId('login-password').fill(newPassword)
  await page.getByTestId('login-submit').click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
})
