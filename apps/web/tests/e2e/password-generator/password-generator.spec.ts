import { test, expect } from '../fixtures/test'

test('standalone password generator creates, tunes, and copies a password locally', async ({
  authenticatedPage: page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.goto('/password-generator')
  await expect(page.getByTestId('password-generator-heading')).toContainText('Password Generator')

  await page.getByLabel('Password length', { exact: true }).fill('24')
  await page.getByRole('switch', { name: 'Symbols' }).click()
  await page.getByRole('switch', { name: 'Avoid ambiguous characters' }).click()
  await page.getByRole('button', { name: 'Generate password' }).click()

  const generated = page.getByTestId('password-generator-output')
  await expect(generated).toHaveValue(/^[^!@#$%^&*()_\-+=[\]{};:,.<>/?~`|\\'"]{24}$/)
  await expect(page.getByTestId('password-generator-strength')).toContainText(/Strong|Excellent/)

  await page.getByRole('button', { name: 'Copy password' }).click()
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toHaveLength(24)
})

test('password manager uses the shared generator to populate a login password field', async ({
  authenticatedPage: page,
}) => {
  const setupPassword = 'LocalUnlockPassword!42'

  await page.goto('/password-manager')
  await expect(page.getByTestId('password-manager-state-setup-required')).toBeVisible()

  await page.getByLabel('Unlock password', { exact: true }).fill(setupPassword)
  await page.getByLabel('Confirm unlock password', { exact: true }).fill(setupPassword)
  await page.getByRole('button', { name: 'Create unlock profile' }).click()
  await expect(page.getByTestId('password-manager-workspace')).toBeVisible()

  await page.getByRole('button', { name: 'Create vault' }).click()
  await page.getByLabel('Vault name').fill('Shared production')
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()

  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New login' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate password' }).click()
  await expect(page.getByRole('dialog', { name: 'Password Generator' })).toBeVisible()

  await page.getByLabel('Password length', { exact: true }).fill('28')
  await page.getByRole('button', { name: 'Use password' }).click()

  await expect(page.getByRole('dialog', { name: 'New login' })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(/.{28}/)
})
