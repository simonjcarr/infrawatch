import { request as playwrightRequest } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'

test('user without an organisation can create one from onboarding', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be configured')

  const sql = getTestDb()
  const suffix = Date.now().toString()
  const email = `onboarding-${suffix}@example.com`
  const password = 'TestPassword123!'
  const organisationName = `Onboarding Org ${suffix}`
  const organisationSlug = `onboarding-org-${suffix}`

  const authRequest = await playwrightRequest.newContext({ baseURL })
  try {
    const signUpResponse = await authRequest.post('/api/auth/sign-up/email', {
      data: {
        email,
        password,
        name: 'Onboarding Test User',
      },
    })
    expect(signUpResponse.ok()).toBeTruthy()

    await sql`
      UPDATE "user"
      SET email_verified = true,
          is_active = true
      WHERE email = ${email}
    `

    const signInResponse = await authRequest.post('/api/auth/sign-in/email', {
      data: {
        email,
        password,
      },
    })
    expect(signInResponse.ok()).toBeTruthy()

    const storageState = await authRequest.storageState()
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    try {
      await page.goto('/onboarding')
      await page.waitForURL('**/onboarding')
      await expect(page.getByText('Create your organisation', { exact: true })).toBeVisible()

      await page.getByTestId('onboarding-name').fill(organisationName)
      await expect(page.getByTestId('onboarding-slug')).toHaveValue(organisationSlug)
      await page.getByTestId('onboarding-submit').click()

      await page.waitForURL('**/dashboard')
      await expect(page.getByTestId('dashboard-heading')).toBeVisible()
    } finally {
      await context.close()
    }
  } finally {
    await authRequest.dispose()
  }

  const [user] = await sql<Array<{ organisation_id: string | null; role: string }>>`
    SELECT organisation_id, role
    FROM "user"
    WHERE email = ${email}
    LIMIT 1
  `

  expect(user?.organisation_id).not.toBeNull()
  expect(user?.role).toBe('super_admin')

  const [organisation] = await sql<Array<{ name: string; slug: string }>>`
    SELECT name, slug
    FROM organisations
    WHERE slug = ${organisationSlug}
    LIMIT 1
  `

  expect(organisation?.name).toBe(organisationName)
  expect(organisation?.slug).toBe(organisationSlug)
})
