import { test, expect } from '../fixtures/test'

function privateKeyBlock() {
  return [
    `${'-'.repeat(5)}BEGIN OPENSSH PRIVATE KEY${'-'.repeat(5)}`,
    'fixture-key-body',
    `${'-'.repeat(5)}END OPENSSH PRIVATE KEY${'-'.repeat(5)}`,
  ].join('\n')
}

test('admin can enable Ansible automation and create an SSH credential profile', async ({ authenticatedPage: page }) => {
  await page.goto('/settings/integrations/automation')

  await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible()
  await expect(page.getByText('Ansible automation', { exact: true })).toBeVisible()
  await expect(page.getByText('Ansible module connection')).toBeHidden()

  await page.getByTestId('settings-automation-ansible-toggle').click()
  await expect(page.getByText('Restart required')).toBeVisible()
  await expect(page.getByText('Ansible module connection')).toBeVisible()
  await expect(page.getByText(/Check the configured Ansible API URL/)).toBeVisible()
  await expect(page.getByText('ghcr.io/carrtech-dev/ct-ops/ansible-api:latest')).toBeVisible()
  await page.getByText('Run the Ansible container').click()
  await expect(page.getByText('docker compose -f docker-compose.single.yml --profile ansible up -d ansible-api')).toBeVisible()
  await expect(page.getByText('http://ansible-api:8080')).toBeVisible()
  await page.getByRole('tab', { name: 'Separate Server' }).click()
  await expect(page.getByText('docker run -d --name ct-ops-ansible-api')).toBeVisible()
  await expect(page.getByText(/Do not set ANSIBLE_API_SERVICE_TOKEN_ID/)).toBeVisible()
  await page.getByRole('tab', { name: 'Auth & TLS' }).click()
  await expect(page.getByText('A service token is a shared HMAC secret.')).toBeVisible()
  await expect(page.getByText(/Authentication set to None means CT-Ops sends unsigned requests/)).toBeVisible()
  await expect(page.getByText(/Authentication does not control encryption/)).toBeVisible()

  await page.getByTestId('ansible-credential-name').fill('Linux admin key')
  await page.getByTestId('ansible-credential-username').fill('deploy')
  await page.getByTestId('ansible-credential-private-key').fill(privateKeyBlock())
  await page.getByTestId('ansible-credential-save').click()

  await expect(page.getByText('Linux admin key')).toBeVisible()
  await expect(page.getByText('deploy', { exact: true })).toBeVisible()
})
