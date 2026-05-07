import { test, expect } from '../fixtures/test'
import { TEST_PASSWORD_MANAGER_MEMBER } from '../fixtures/seed'

test('hosted password manager flow keeps plaintext and key material inside the browser', async ({
  authenticatedPage: page,
  passwordManagerMock,
}) => {
  test.setTimeout(60_000)

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const setupPassword = 'LocalUnlockPassword!42'
  const exportPassword = 'EncryptedVaultExport!42'
  const entryPassword = 'SuperSecretPassword!99'
  const updatedEntryPassword = 'RotatedPassword!100'
  const entryNotes = 'Recovery codes and production notes'
  const cardNumber = '4111111111111111'

  const consoleMessages: string[] = []
  const pageErrors: string[] = []
  const outboundBodies: Array<{ url: string; body: string }> = []
  page.on('console', (message) => {
    consoleMessages.push(message.text())
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })
  page.on('request', (request) => {
    if (!request.url().includes('/password-manager') || request.method() === 'GET') {
      return
    }
    outboundBodies.push({
      url: request.url(),
      body: request.postData() ?? '',
    })
  })

  await page.goto('/password-manager')
  await expect(page.getByTestId('password-manager-shell')).toBeVisible()
  await expect(page.getByTestId('password-manager-state-setup-required')).toBeVisible()

  await page.getByLabel('Unlock password', { exact: true }).fill(setupPassword)
  await page.getByLabel('Confirm unlock password', { exact: true }).fill(setupPassword)
  await page.getByRole('button', { name: 'Create unlock profile' }).click()

  await expect(page.getByTestId('password-manager-workspace')).toBeVisible()
  await expect(page.getByText('Unlock profile created and loaded locally for this browser session.')).toBeVisible()

  await page.getByRole('button', { name: 'Create vault' }).click()
  await page.getByLabel('Vault name').fill('Shared production')
  await page.getByLabel('Description').fill('Primary production credentials')
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()

  const vaultButton = page.getByTestId('password-manager-vault-vault-1')
  await expect(vaultButton).toContainText('Shared production')
  await expect(page.getByTestId('password-manager-entry-table')).toBeVisible()

  await expect(page.getByLabel('Title')).toHaveCount(0)
  await page.getByTestId('password-manager-entry-template-menu').click()
  await expect(page.getByRole('menuitemradio', { name: /Login/ })).toBeChecked()
  await page.getByRole('menuitemradio', { name: /Card/ }).click()
  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New card' })).toBeVisible()
  await page.getByLabel('Title').fill('Company card')
  await page.getByLabel('Cardholder name').fill('Ops Admin')
  await page.getByLabel('Card number').fill(cardNumber)
  await page.getByLabel('Expiry month').fill('12')
  await page.getByLabel('Expiry year').fill('2030')
  await page.getByLabel('Security code').fill('123')
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()
  await expect(page.getByTestId('password-manager-entry-entry-1')).toContainText('Company card')

  await page.getByTestId('password-manager-entry-template-menu').click()
  await page.getByRole('menuitemradio', { name: /Login/ }).click()
  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New login' })).toBeVisible()
  await page.getByLabel('Title').fill('Grafana admin')
  await page.getByLabel('Username').fill('ops-admin')
  await page.getByLabel('Password', { exact: true }).fill(entryPassword)
  await page.getByLabel('URL').fill('https://grafana.example.test')
  await page.getByLabel('Notes').fill(entryNotes)
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()

  const entryCard = page.getByTestId('password-manager-entry-entry-2')
  await expect(entryCard).toContainText('Grafana admin')
  await expect(entryCard).toContainText('ops-admin')

  await entryCard.getByRole('button', { name: 'Reveal password' }).click()
  await expect(entryCard.getByText(entryPassword)).toBeVisible()
  await expect(entryCard.getByTestId('password-manager-reveal-progress-entry-2')).toBeVisible()
  await expect(entryCard.getByText('10s reveal')).toBeVisible()

  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByLabel('Reveal password duration').fill('2')
  await page.getByLabel('Clipboard clear duration').fill('3')
  await page.getByRole('button', { name: 'Rename vault' }).click()
  await expect(page.getByText('Vault metadata updated in encrypted form.')).toBeVisible()

  await page.getByRole('tab', { name: 'Passwords' }).click()
  await expect(entryCard.getByText(entryPassword)).toHaveCount(0)
  await entryCard.getByRole('button', { name: 'Reveal password' }).click()
  await expect(entryCard.getByText(entryPassword)).toBeVisible()
  await expect(entryCard.getByText('2s reveal')).toBeVisible()
  await expect(entryCard.getByText(entryPassword)).toHaveCount(0, { timeout: 4_000 })

  await entryCard.getByRole('button', { name: 'Copy password' }).click()
  await expect(entryCard.getByTestId('password-manager-clipboard-progress-entry-2')).toBeVisible()
  await expect(entryCard.getByText('3s clipboard')).toBeVisible()
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(entryPassword)
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toBe('')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export vault' }).click()
  await expect(page.getByRole('dialog', { name: 'Export vault' })).toBeVisible()
  await page.getByLabel('Unlock password', { exact: true }).fill(setupPassword)
  await page.getByLabel('Export file password', { exact: true }).fill(exportPassword)
  await page.getByLabel('Confirm export file password').fill(exportPassword)
  await page.getByLabel('Type "I understand the risks"').fill('I understand the risks')
  await page.getByRole('button', { name: 'Export encrypted ZIP' }).click()
  await downloadPromise

  await entryCard.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit login' })).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill(updatedEntryPassword)
  await page.getByRole('button', { name: 'Save encrypted entry' }).click()
  await expect(entryCard.getByRole('button', { name: 'Reveal password' })).toBeVisible()

  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByTestId('password-manager-member-user-selector').click()
  await page.getByText(TEST_PASSWORD_MANAGER_MEMBER.email).click()
  await page.getByRole('button', { name: 'Add member' }).click()
  await expect.poll(() => passwordManagerMock.requestsFor('POST', '/vaults/vault-1/members').length).toBe(1)
  const addMemberRequest = passwordManagerMock.requestsFor('POST', '/vaults/vault-1/members')[0]
  const addedMemberUserId =
    addMemberRequest?.jsonBody && typeof addMemberRequest.jsonBody === 'object' && !Array.isArray(addMemberRequest.jsonBody)
      ? String(addMemberRequest.jsonBody.user_id)
      : ''
  await expect(page.getByText(addedMemberUserId)).toBeVisible()

  const memberCard = page.getByTestId(`password-manager-member-${addedMemberUserId}`)
  await memberCard.getByRole('button', { name: 'Save role' }).click()
  await memberCard.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Key rotation recommended')).toBeVisible()

  passwordManagerMock.failNextRefreshWithSessionExpiry()
  await page.getByRole('button', { name: 'Refresh session' }).click()
  await expect(page.getByTestId('password-manager-state-session-expired')).toBeVisible()

  await page.getByRole('button', { name: 'Relaunch' }).click()
  await expect(page.getByTestId('password-manager-state-locked')).toBeVisible()
  await page.getByLabel('Unlock password', { exact: true }).fill(setupPassword)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByTestId('password-manager-workspace')).toBeVisible()

  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Rotate vault key' }).click()
  await expect(page.getByText('Vault key rotated safely for the current active members.')).toBeVisible()

  await page.getByRole('tab', { name: 'Passwords' }).click()
  await entryCard.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Delete entry' }).click()
  await expect(page.getByTestId('password-manager-entry-entry-2')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Delete vault' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Delete vault' })).toBeVisible()
  await expect(page.getByText('This is irreversible')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete vault permanently' })).toBeDisabled()
  await page.getByLabel('Unlock password', { exact: true }).fill(setupPassword)
  await page.getByLabel('Type the vault name').fill('Shared production')
  await page.getByRole('button', { name: 'Delete vault permanently' }).click()
  await expect(page.getByTestId('password-manager-vault-vault-1')).toHaveCount(0)

  await passwordManagerMock.switchAuthenticatedOrganisation()
  await page.reload()
  await expect(page.getByTestId('password-manager-state-setup-required')).toBeVisible()

  expect(passwordManagerMock.launchAssertions()).toHaveLength(3)
  expect(passwordManagerMock.requestsFor('POST', '/vaults')).toHaveLength(1)
  expect(passwordManagerMock.requestsFor('POST', '/vaults/vault-1/key-epochs')).toHaveLength(1)

  const auditPaths = passwordManagerMock.auditRequests().map((request) => request.path)
  expect(auditPaths).toEqual([
    '/vaults/vault-1/entries/entry-2/reveal-audit',
    '/vaults/vault-1/entries/entry-2/reveal-audit',
    '/vaults/vault-1/entries/entry-2/copy-audit',
    '/vaults/vault-1/export-audit',
  ])

  for (const request of passwordManagerMock.auditRequests()) {
    expect(request.rawBody).toBe('')
  }

  const createVaultRequests = passwordManagerMock.requestsFor('POST', '/vaults')
  expect(createVaultRequests[0]?.headers['idempotency-key']).toBeTruthy()

  const rotateRequests = passwordManagerMock.requestsFor('POST', '/vaults/vault-1/key-epochs')
  expect(rotateRequests[0]?.headers['idempotency-key']).toBeTruthy()

  for (const request of passwordManagerMock.apiRequests()) {
    expect(request.credentialsCookie).toBe(true)
    expect(request.rawBody).not.toContain(setupPassword)
    expect(request.rawBody).not.toContain(exportPassword)
    expect(request.rawBody).not.toContain(cardNumber)
    expect(request.rawBody).not.toContain(entryPassword)
    expect(request.rawBody).not.toContain(updatedEntryPassword)
    expect(request.rawBody).not.toContain(entryNotes)
  }

  expect(passwordManagerMock.detectPlaintextLeak()).toBeNull()

  for (const message of consoleMessages) {
    expect(message).not.toContain(setupPassword)
    expect(message).not.toContain(exportPassword)
    expect(message).not.toContain(cardNumber)
    expect(message).not.toContain(entryPassword)
    expect(message).not.toContain(updatedEntryPassword)
    expect(message).not.toContain(entryNotes)
  }

  expect(pageErrors).toEqual([])

  for (const request of outboundBodies) {
    expect(request.body).not.toContain(setupPassword)
    expect(request.body).not.toContain(exportPassword)
    expect(request.body).not.toContain(cardNumber)
    expect(request.body).not.toContain(entryPassword)
    expect(request.body).not.toContain(updatedEntryPassword)
    expect(request.body).not.toContain(entryNotes)
  }
})
