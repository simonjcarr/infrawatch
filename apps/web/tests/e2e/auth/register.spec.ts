import { test, expect } from '../fixtures/test'
import { waitForVerificationUrl } from '../fixtures/email'

test('email sign-up requires verification before dashboard access', async ({ page }) => {
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

  const verificationUrl = await waitForVerificationUrl(email)
  await page.goto(verificationUrl)

  await page.waitForURL('**/onboarding')
  await expect(page.getByText('Create your organisation')).toBeVisible()
})
