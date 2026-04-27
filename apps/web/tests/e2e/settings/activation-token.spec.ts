import { test, expect } from '../fixtures/test'
import { decodeActivationToken } from '@/lib/licence-activation-token'
import { TEST_ORG } from '../fixtures/seed'

test('admin can generate an activation token from settings', async ({ authenticatedPage: page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/settings')

  await expect(page.getByTestId('settings-heading')).toBeVisible()
  await page.getByTestId('activation-token-generate').click()

  const activationToken = page.getByTestId('activation-token')
  await expect(activationToken).toBeVisible()
  await expect(activationToken).not.toBeEmpty()
  await expect(page.getByTestId('activation-token-generate')).toHaveText('Generate a new token')

  const firstToken = await activationToken.textContent()
  expect(firstToken).toBeTruthy()
  const firstDecoded = decodeActivationToken(firstToken ?? '')
  expect(firstDecoded.ok).toBe(true)
  if (firstDecoded.ok) {
    expect(firstDecoded.payload.installOrgName).toBe(TEST_ORG.name)
    expect(firstDecoded.payload.installOrgId).toBeTruthy()
  }

  await page.getByTestId('activation-token-copy').click()
  await expect(page.getByTestId('activation-token-copy')).toContainText('Copied')
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(firstToken)

  await page.getByTestId('activation-token-generate').click()
  await expect(activationToken).not.toHaveText(firstToken ?? '')

  const secondToken = await activationToken.textContent()
  expect(secondToken).toBeTruthy()
  const secondDecoded = decodeActivationToken(secondToken ?? '')
  expect(secondDecoded.ok).toBe(true)
  if (firstDecoded.ok && secondDecoded.ok) {
    expect(secondDecoded.payload.installOrgId).toBe(firstDecoded.payload.installOrgId)
    expect(secondDecoded.payload.installOrgName).toBe(TEST_ORG.name)
    expect(secondDecoded.payload.nonce).not.toBe(firstDecoded.payload.nonce)
  }
})
