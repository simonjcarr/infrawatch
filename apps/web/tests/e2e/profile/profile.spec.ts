import { test, expect } from '../fixtures/test'
import { request as playwrightRequest } from '@playwright/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG, TEST_USER } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ orgId: string; userId: string }> {
  const rows = await sql<Array<{ org_id: string; user_id: string }>>`
    SELECT organisations.id AS org_id, "user".id AS user_id
    FROM organisations
    JOIN "user" ON "user".organisation_id = organisations.id
    WHERE organisations.slug = ${TEST_ORG.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  return {
    orgId: rows[0]!.org_id,
    userId: rows[0]!.user_id,
  }
}

test('authenticated user can update their display name from profile', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const updatedName = `Updated ${Date.now()}`

  await page.goto('/profile')

  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  const nameInput = page.getByLabel('Full name')
  await nameInput.click()
  await nameInput.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
  await nameInput.fill(updatedName)
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Saved')).toBeVisible()
  await expect(nameInput).toHaveValue(updatedName)

  const rows = await sql<Array<{ name: string }>>`
    SELECT name
    FROM "user"
    WHERE email = ${TEST_USER.email}
    LIMIT 1
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe(updatedName)
})

test('authenticated user can change their password from profile', async ({ authenticatedPage: page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be configured')

  const updatedPassword = 'UpdatedPassword123!'
  const authRequest = await playwrightRequest.newContext({ baseURL })

  try {
    await page.goto('/profile')

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await page.getByTestId('profile-password-current').fill(TEST_USER.password)
    await page.getByTestId('profile-password-new').fill(updatedPassword)
    await page.getByTestId('profile-password-confirm').fill(updatedPassword)
    await page.getByTestId('profile-password-submit').click()

    await expect(page.getByTestId('profile-password-success')).toBeVisible()

    const oldPasswordResponse = await authRequest.post('/api/auth/sign-in/email', {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    })
    expect(oldPasswordResponse.ok()).toBe(false)

    const newPasswordResponse = await authRequest.post('/api/auth/sign-in/email', {
      data: {
        email: TEST_USER.email,
        password: updatedPassword,
      },
    })
    expect(newPasswordResponse.ok()).toBe(true)

    await page.getByTestId('profile-password-current').fill(updatedPassword)
    await page.getByTestId('profile-password-new').fill(TEST_USER.password)
    await page.getByTestId('profile-password-confirm').fill(TEST_USER.password)
    await page.getByTestId('profile-password-submit').click()
    await expect(page.getByTestId('profile-password-success')).toBeVisible()

    const restoreCheckRequest = await playwrightRequest.newContext({ baseURL })
    try {
      const restoredPasswordResponse = await restoreCheckRequest.post('/api/auth/sign-in/email', {
        data: {
          email: TEST_USER.email,
          password: TEST_USER.password,
        },
      })
      expect(restoredPasswordResponse.ok()).toBe(true)
    } finally {
      await restoreCheckRequest.dispose()
    }
  } finally {
    await authRequest.dispose()
  }
})

test('authenticated user can opt out of in-app notifications when the organisation allows it', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await sql`
    UPDATE organisations
    SET metadata = jsonb_build_object(
      'notificationSettings',
      jsonb_build_object(
        'inAppEnabled', true,
        'allowUserOptOut', true,
        'inAppRoles', '["owner","admin","member"]'::jsonb
      )
    )
    WHERE id = ${orgId}
  `

  await sql`
    UPDATE "user"
    SET notifications_enabled = true
    WHERE id = ${userId}
  `

  await page.goto('/profile')

  await expect(page.getByText('Notifications')).toBeVisible()
  const toggle = page.getByTestId('profile-notifications-toggle')
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  await toggle.click()

  await expect(page.getByTestId('profile-notifications-success')).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ notifications_enabled: boolean }>>`
        SELECT notifications_enabled
        FROM "user"
        WHERE id = ${userId}
        LIMIT 1
      `

      return rows[0]?.notifications_enabled ?? null
    })
    .toBe(false)
})
