import { test, expect } from '../fixtures/test'
import { decodeActivationToken } from '@/lib/licence-activation-token'
import { TEST_INSTANCE } from '../fixtures/seed'

test('admin can generate an activation token from settings', async ({ authenticatedPage: page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/settings/licence')

  await expect(page.getByTestId('settings-heading')).toContainText('Instance')
  await expect(page.getByTestId('licence-instance-name')).toHaveText(TEST_INSTANCE.name)
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
    expect(firstDecoded.payload.installInstanceName).toBe(TEST_INSTANCE.name)
    expect(firstDecoded.payload.installInstanceId).toBeTruthy()
    await expect(page.getByTestId('licence-instance-id')).toHaveText(firstDecoded.payload.installInstanceId)
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
    expect(secondDecoded.payload.installInstanceId).toBe(firstDecoded.payload.installInstanceId)
    expect(secondDecoded.payload.installInstanceName).toBe(TEST_INSTANCE.name)
    expect(secondDecoded.payload.nonce).not.toBe(firstDecoded.payload.nonce)
  }
})
