import { writeFileSync } from 'node:fs'

import { test, expect } from '../fixtures/test'
import { TEST_PASSWORD_MANAGER_MEMBER } from '../fixtures/seed'

test('hosted password manager flow keeps plaintext and key material inside the browser', async ({
  authenticatedPage: page,
  passwordManagerMock,
}, testInfo) => {
  test.setTimeout(120_000)

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const setupPassword = 'LocalUnlockPassword!42'
  const exportPassword = 'EncryptedVaultExport!42'
  const entryPassword = 'SuperSecretPassword!99'
  const updatedEntryPassword = 'RotatedPassword!100'
  const entryNotes = 'Recovery codes and production notes'
  const cardNumber = '4111111111111111'
  const pastedSshPublicMaterial = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPastedDeployPublicKey deploy@example.test'
  const pastedSshPrivateKey = 'pasted SSH private key fixture material'
  const uploadedSshPublicMaterial = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQUploadedDeployPublicKey uploaded@example.test'
  const uploadedSshPrivateKey = 'uploaded SSH private key fixture material'
  const generatedSshPassphrase = 'GeneratedSshPassphrase!42'
  let generatedEd25519PublicMaterial = ''
  let generatedEd25519PrivateKey = ''
  let generatedRsaPublicMaterial = ''
  let generatedRsaPrivateKey = ''
  const uploadedSshPublicPath = testInfo.outputPath('uploaded-ssh-key.pub')
  const uploadedSshPrivatePath = testInfo.outputPath('uploaded-ssh-key')
  writeFileSync(uploadedSshPublicPath, uploadedSshPublicMaterial)
  writeFileSync(uploadedSshPrivatePath, uploadedSshPrivateKey)

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
  await expect(page.locator('#password-manager-entry-securityCode')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show security code' }).click()
  await expect(page.locator('#password-manager-entry-securityCode')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide security code' }).click()
  await expect(page.locator('#password-manager-entry-securityCode')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()
  await expect(page.getByTestId('password-manager-entry-entry-1')).toContainText('Company card')

  await page.getByTestId('password-manager-entry-template-menu').click()
  await page.getByRole('menuitemradio', { name: /Login/ }).click()
  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New login' })).toBeVisible()
  await page.getByLabel('Title').fill('Grafana admin')
  await page.getByLabel('Username').fill('ops-admin')
  await page.getByLabel('Password', { exact: true }).fill(entryPassword)
  await expect(page.locator('#password-manager-entry-password')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.locator('#password-manager-entry-password')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(page.locator('#password-manager-entry-password')).toHaveAttribute('type', 'password')
  await page.getByLabel('URL').fill('https://grafana.example.test')
  await page.getByLabel('Notes').fill(entryNotes)
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()

  const entryCard = page.getByTestId('password-manager-entry-entry-2')
  await expect(entryCard).toContainText('Grafana admin')
  await expect(entryCard).toContainText('ops-admin')

  await page.getByTestId('password-manager-entry-template-menu').click()
  await page.getByRole('menuitemradio', { name: /SSH Key Pair/ }).click()
  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New SSH key pair' })).toBeVisible()
  await page.getByLabel('Title').fill('Pasted deploy key')
  await page.getByLabel('Public key or certificate').fill(pastedSshPublicMaterial)
  await page.getByLabel('Private key').fill(pastedSshPrivateKey)
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()
  const pastedSshEntry = page.getByTestId('password-manager-entry-entry-3')
  await expect(pastedSshEntry).toContainText('Pasted deploy key')
  await expect(pastedSshEntry).toContainText('SSH key pair')
  await expect(pastedSshEntry.getByRole('button', { name: 'Reveal password' })).toHaveCount(0)
  await expect(pastedSshEntry.getByRole('button', { name: 'Copy password' })).toHaveCount(0)
  await expect(pastedSshEntry.getByRole('button', { name: 'View entry' })).toBeVisible()

  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New SSH key pair' })).toBeVisible()
  await page.getByLabel('Title').fill('Uploaded deploy key')
  await page.locator('#password-manager-entry-publicMaterial-file').setInputFiles(uploadedSshPublicPath)
  await page.locator('#password-manager-entry-privateKey-file').setInputFiles(uploadedSshPrivatePath)
  await expect(page.getByLabel('Public key or certificate')).toHaveValue(uploadedSshPublicMaterial)
  await expect(page.getByLabel('Private key')).toHaveValue(uploadedSshPrivateKey)
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()
  await expect(page.getByTestId('password-manager-entry-entry-4')).toContainText('Uploaded deploy key')

  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New SSH key pair' })).toBeVisible()
  await page.getByLabel('Title').fill('Generated Ed25519 deploy key')
  await page.getByLabel('Algorithm').click()
  await expect(page.getByRole('option', { name: 'ED25519', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: /id_ed25519/ })).toHaveCount(0)
  await page.getByRole('option', { name: 'ED25519', exact: true }).click()
  await page.getByLabel('Password protect generated private key').check()
  await page.getByLabel('Key passphrase').fill(generatedSshPassphrase)
  await page.getByLabel('Confirm key passphrase').fill(generatedSshPassphrase)
  await expect(page.locator('#password-manager-ssh-key-passphrase')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show key passphrase' }).click()
  await expect(page.locator('#password-manager-ssh-key-passphrase')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide key passphrase' }).click()
  await expect(page.locator('#password-manager-ssh-key-passphrase')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Generate key pair' }).click()
  await expect(page.getByLabel('Public key or certificate')).toHaveValue(/^ssh-ed25519 /)
  await expect(page.getByLabel('Private key')).toHaveValue(/BEGIN OPENSSH PRIVATE KEY/)
  generatedEd25519PublicMaterial = await page.getByLabel('Public key or certificate').inputValue()
  generatedEd25519PrivateKey = await page.getByLabel('Private key').inputValue()
  expect(generatedEd25519PrivateKey).not.toContain(generatedSshPassphrase)
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()
  await expect(page.getByTestId('password-manager-entry-entry-5')).toContainText('Generated Ed25519 deploy key')

  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(page.getByRole('dialog', { name: 'New SSH key pair' })).toBeVisible()
  await page.getByLabel('Title').fill('Generated RSA deploy key')
  await page.getByLabel('Algorithm').click()
  await page.getByRole('option', { name: 'RSA 4096' }).click()
  await page.getByRole('button', { name: 'Generate key pair' }).click()
  await expect(page.getByLabel('Public key or certificate')).toHaveValue(/^ssh-rsa /)
  await expect(page.getByLabel('Private key')).toHaveValue(/BEGIN OPENSSH PRIVATE KEY/)
  generatedRsaPublicMaterial = await page.getByLabel('Public key or certificate').inputValue()
  generatedRsaPrivateKey = await page.getByLabel('Private key').inputValue()
  await page.getByRole('button', { name: 'Create encrypted entry' }).click()
  await expect(page.getByTestId('password-manager-entry-entry-6')).toContainText('Generated RSA deploy key')

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

  await pastedSshEntry.getByRole('button', { name: 'View entry' }).click()
  await expect(page.getByRole('dialog', { name: 'View SSH key pair' })).toBeVisible()
  await expect(page.getByLabel('Title')).toBeDisabled()
  await expect(page.getByLabel('Public key or certificate')).toBeDisabled()
  await expect(page.getByLabel('Private key')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save encrypted entry' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Delete entry' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Copy public key or certificate' }).click()
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe(pastedSshPublicMaterial)
  await page.getByRole('button', { name: 'Copy private key' }).click()
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe(pastedSshPrivateKey)
  await page.getByRole('button', { name: 'Close' }).click()

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

  await passwordManagerMock.switchAuthenticatedInstance()
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
    '/vaults/vault-1/entries/entry-3/copy-audit',
    '/vaults/vault-1/entries/entry-3/copy-audit',
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
    expect(request.rawBody).not.toContain(pastedSshPublicMaterial)
    expect(request.rawBody).not.toContain(pastedSshPrivateKey)
    expect(request.rawBody).not.toContain(uploadedSshPublicMaterial)
    expect(request.rawBody).not.toContain(uploadedSshPrivateKey)
    expect(request.rawBody).not.toContain(generatedSshPassphrase)
    expect(request.rawBody).not.toContain(generatedEd25519PublicMaterial)
    expect(request.rawBody).not.toContain(generatedEd25519PrivateKey)
    expect(request.rawBody).not.toContain(generatedRsaPublicMaterial)
    expect(request.rawBody).not.toContain(generatedRsaPrivateKey)
  }

  expect(passwordManagerMock.detectPlaintextLeak()).toBeNull()

  for (const message of consoleMessages) {
    expect(message).not.toContain(setupPassword)
    expect(message).not.toContain(exportPassword)
    expect(message).not.toContain(cardNumber)
    expect(message).not.toContain(entryPassword)
    expect(message).not.toContain(updatedEntryPassword)
    expect(message).not.toContain(entryNotes)
    expect(message).not.toContain(pastedSshPublicMaterial)
    expect(message).not.toContain(pastedSshPrivateKey)
    expect(message).not.toContain(uploadedSshPublicMaterial)
    expect(message).not.toContain(uploadedSshPrivateKey)
    expect(message).not.toContain(generatedSshPassphrase)
    expect(message).not.toContain(generatedEd25519PublicMaterial)
    expect(message).not.toContain(generatedEd25519PrivateKey)
    expect(message).not.toContain(generatedRsaPublicMaterial)
    expect(message).not.toContain(generatedRsaPrivateKey)
  }

  expect(pageErrors).toEqual([])

  for (const request of outboundBodies) {
    expect(request.body).not.toContain(setupPassword)
    expect(request.body).not.toContain(exportPassword)
    expect(request.body).not.toContain(cardNumber)
    expect(request.body).not.toContain(entryPassword)
    expect(request.body).not.toContain(updatedEntryPassword)
    expect(request.body).not.toContain(entryNotes)
    expect(request.body).not.toContain(pastedSshPublicMaterial)
    expect(request.body).not.toContain(pastedSshPrivateKey)
    expect(request.body).not.toContain(uploadedSshPublicMaterial)
    expect(request.body).not.toContain(uploadedSshPrivateKey)
    expect(request.body).not.toContain(generatedSshPassphrase)
    expect(request.body).not.toContain(generatedEd25519PublicMaterial)
    expect(request.body).not.toContain(generatedEd25519PrivateKey)
    expect(request.body).not.toContain(generatedRsaPublicMaterial)
    expect(request.body).not.toContain(generatedRsaPrivateKey)
  }
})
