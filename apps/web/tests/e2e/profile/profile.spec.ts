import { test, expect } from '../fixtures/test'
import { request as playwrightRequest } from '@playwright/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER } from '../fixtures/seed'

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
