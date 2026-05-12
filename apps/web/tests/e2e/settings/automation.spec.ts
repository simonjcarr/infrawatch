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
  await expect(page.getByText('Ansible automation')).toBeVisible()

  await page.getByTestId('settings-automation-ansible-toggle').click()
  await expect(page.getByText('Restart required')).toBeVisible()
  await expect(page.getByText(/Run \.\/start\.sh/)).toBeVisible()

  await page.getByTestId('ansible-credential-name').fill('Linux admin key')
  await page.getByTestId('ansible-credential-username').fill('deploy')
  await page.getByTestId('ansible-credential-private-key').fill(privateKeyBlock())
  await page.getByTestId('ansible-credential-save').click()

  await expect(page.getByText('Linux admin key')).toBeVisible()
  await expect(page.getByText('deploy')).toBeVisible()
})
