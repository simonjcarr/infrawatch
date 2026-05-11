import { test, expect } from '../fixtures/test'
import { countVerificationEmails, waitForVerificationUrl } from '../fixtures/email'
import { getTestDb } from '../fixtures/db'
import { TEST_USER } from '../fixtures/seed'

const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION !== 'false'

test('email sign-up requires verification before dashboard access', async ({ page }) => {
  test.skip(!requireEmailVerification, 'email verification is disabled for this run')

  const email = `verify-${Date.now()}@example.com`
  const password = 'TestPassword123!'

  await page.goto('/register')
  await page.getByLabel('Full name').fill('Verification Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/^Password$/).fill(password)
  await page.getByLabel(/^Confirm password$/).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.waitForURL('**/check-email*')
  await expect(page.getByText(`We sent a verification link to ${email}.`)).toBeVisible()

  await page.goto('/dashboard')
  await page.waitForURL('**/login')

  await page.goto('/login')
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  await page.getByTestId('manage-email-verification').click()
  await page.waitForURL('**/check-email*')
  await expect(page.getByTestId('verification-email')).toHaveValue(email)

  const emailsBeforeInvalidResend = await countVerificationEmails(email)
  const invalidResend = await page.request.post('/api/auth/resend-verification-email', {
    data: {
      email,
      password: 'WrongPassword123!',
    },
  })
  expect(invalidResend.status()).toBe(401)
  await expect.poll(() => countVerificationEmails(email)).toBe(emailsBeforeInvalidResend)

  await page.getByTestId('verification-password').fill(password)
  await page.getByTestId('resend-verification-email').click()
  await expect(page.getByTestId('resend-verification-message')).toContainText('Verification email sent')

  const verificationUrl = await waitForVerificationUrl(email)
  await page.goto(verificationUrl)

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
})

test('email sign-up can continue without verification when disabled', async ({ page }) => {
  test.skip(requireEmailVerification, 'email verification is required for this run')

  const email = `no-verify-${Date.now()}@example.com`
  const password = 'TestPassword123!'

  await page.goto('/register')
  await page.getByLabel('Full name').fill('No Verification Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/^Password$/).fill(password)
  await page.getByLabel(/^Confirm password$/).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()

  const sql = getTestDb()
  const rows = await sql<Array<{ id: string; email_verified: boolean }>>`
    SELECT id, email_verified FROM "user" WHERE email = ${email} LIMIT 1
  `
  expect(rows).toHaveLength(1)
  const user = rows[0]
  if (!user) throw new Error(`created user not found: ${email}`)
  expect(user.email_verified).toBe(false)
  await sql`DELETE FROM "session" WHERE user_id = ${user.id}`
  await page.context().clearCookies()

  await page.goto('/login')
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/dashboard')

  await page.goto('/dashboard')
  await page.waitForURL('**/dashboard')
})

test('direct sign-ups wait for role assignment and appear in the people list', async ({ page }) => {
  test.skip(requireEmailVerification, 'email verification is required for this run')

  const suffix = Date.now()
  const directEmail = `direct-member-${suffix}@example.com`
  const password = 'TestPassword123!'
  const sql = getTestDb()

  await page.goto('/register')
  await page.getByLabel('Full name').fill('Direct Member')
  await page.getByLabel('Email').fill(directEmail)
  await page.getByLabel(/^Password$/).fill(password)
  await page.getByLabel(/^Confirm password$/).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/pending-approval')
  await expect(page.getByTestId('pending-approval-card')).toBeVisible()
  await expect(page.getByText('Waiting for a role to be assigned.')).toBeVisible()

  const directRows = await sql<Array<{ id: string; instance_id: string | null; role: string; roles: string[] }>>`
    SELECT id, instance_id, role, roles
    FROM "user"
    WHERE email = ${directEmail}
    LIMIT 1
  `
  expect(directRows).toHaveLength(1)
  expect(directRows[0]?.instance_id).toBeTruthy()
  expect(directRows[0]?.role).toBe('pending')
  expect(directRows[0]?.roles).toEqual([])

  await sql`DELETE FROM "session" WHERE user_id = ${directRows[0]!.id}`
  await page.context().clearCookies()

  await page.goto('/login')
  await page.getByTestId('login-email').fill(TEST_USER.email)
  await page.getByTestId('login-password').fill(TEST_USER.password)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/dashboard')

  await page.goto('/team')
  await expect(page.getByTestId('team-invite-open')).toBeVisible()
  const memberRowsLocator = page.locator('[data-testid^="team-member-row-"]')
  const directMemberRow = memberRowsLocator.filter({ hasText: 'Direct Member' })
  await expect(directMemberRow).toBeVisible()
  await expect(directMemberRow).toContainText('No Role assigned')
})
