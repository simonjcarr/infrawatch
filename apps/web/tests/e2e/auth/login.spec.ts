import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'
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

test('password reset ignores unsafe callback urls and returns to the login notice', async ({ page }) => {
  const sql = getTestDb()
  const suffix = Date.now().toString()
  const email = `reset-callback-${suffix}@example.com`
  const password = 'TestPassword123!'
  const newPassword = 'SafeCallbackReset123!'

  const signUpResponse = await page.request.post('/api/auth/sign-up/email', {
    data: {
      email,
      password,
      name: 'Reset Callback User',
    },
  })
  expect(signUpResponse.ok()).toBeTruthy()

  await sql`
    UPDATE "user"
    SET organisation_id = (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
        email_verified = true,
        role = 'org_admin',
        is_active = true
    WHERE email = ${email}
  `

  await page.request.post('/api/auth/request-password-reset', {
    data: {
      email,
      redirectTo: '/login?reset=1',
    },
  })

  const resetUrl = await waitForPasswordResetUrl(email)
  const unsafeResetUrl = new URL(resetUrl)
  unsafeResetUrl.searchParams.set('callbackURL', 'https://evil.example/phish')

  await page.goto(unsafeResetUrl.toString())
  await page.getByTestId('reset-password-new-password').fill(newPassword)
  await page.getByTestId('reset-password-confirm-password').fill(newPassword)
  await page.getByTestId('reset-password-submit').click()

  await page.waitForURL('**/login?reset=1')
  await expect(page.getByTestId('login-notice')).toContainText('Your password has been reset.')

  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(newPassword)
  await page.getByTestId('login-submit').click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
})
