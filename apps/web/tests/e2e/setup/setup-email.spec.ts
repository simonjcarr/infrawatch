import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

test('ldap placeholder users must set a real email before reaching the dashboard', async ({ page }) => {
  const sql = getTestDb()
  const suffix = Date.now().toString()
  const placeholderEmail = `ldap-user-${suffix}@ldap.local`
  const realEmail = `ldap-user-${suffix}@example.com`
  const password = 'TestPassword123!'

  const signUpResponse = await page.request.post('/api/auth/sign-up/email', {
    data: {
      email: placeholderEmail,
      password,
      name: 'LDAP Placeholder User',
    },
  })
  expect(signUpResponse.ok()).toBeTruthy()

  await sql`
    UPDATE "user"
    SET organisation_id = (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
        email_verified = true,
        role = 'org_admin',
        is_active = true
    WHERE email = ${placeholderEmail}
  `

  await page.goto('/login')
  await page.getByTestId('login-email').fill(placeholderEmail)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()

  await page.waitForURL('**/setup-email')
  await expect(page.getByTestId('setup-email-heading')).toBeVisible()

  await page.getByTestId('setup-email-input').fill(placeholderEmail)
  await page.getByTestId('setup-email-submit').click()
  await expect(page.getByTestId('setup-email-validation-error')).toContainText(
    'Please enter a real email address',
  )

  await page.getByTestId('setup-email-input').fill(realEmail)
  await page.getByTestId('setup-email-submit').click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()

  const rows = await sql<Array<{ email: string }>>`
    SELECT email
    FROM "user"
    WHERE email = ${realEmail}
    LIMIT 1
  `
  expect(rows).toEqual([{ email: realEmail }])
})
