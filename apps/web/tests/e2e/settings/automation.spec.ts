import { test, expect } from '../fixtures/test'

test('admin can enable Ansible automation and create an SSH credential profile', async ({ authenticatedPage: page }) => {
  await page.goto('/settings/integrations/automation')

  await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible()
  await expect(page.getByText('Ansible automation')).toBeVisible()

  await page.getByTestId('settings-automation-ansible-toggle').click()
  await expect(page.getByText('Restart required')).toBeVisible()
  await expect(page.getByText(/Run \.\/start\.sh/)).toBeVisible()

  await page.getByTestId('ansible-credential-name').fill('Linux admin key')
  await page.getByTestId('ansible-credential-username').fill('deploy')
  await page.getByTestId('ansible-credential-private-key').fill([
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'abc',
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n'))
  await page.getByTestId('ansible-credential-save').click()

  await expect(page.getByText('Linux admin key')).toBeVisible()
  await expect(page.getByText('deploy')).toBeVisible()
})
