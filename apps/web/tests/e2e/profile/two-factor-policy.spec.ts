import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER } from '../fixtures/seed'

test('organisation 2FA requirement redirects unprotected users to profile setup', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()

  await sql`
    UPDATE organisations
    SET metadata = jsonb_build_object(
      'securitySettings',
      jsonb_build_object('requireTwoFactor', true)
    )
  `

  await sql`
    UPDATE "user"
    SET two_factor_enabled = false
    WHERE email = ${TEST_USER.email}
  `

  await page.goto('/hosts')

  await expect(page).toHaveURL(/\/profile\?setup=two-factor$/)
  await expect(page.getByTestId('profile-two-factor-required')).toBeVisible()
  await expect(page.getByTestId('profile-two-factor-start')).toBeVisible()
})
