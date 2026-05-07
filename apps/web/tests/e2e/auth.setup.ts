import { test as setup } from '@playwright/test'
import { getStorageStatePath } from './fixtures/auth'
import { seedOrgAndUser } from './fixtures/seed'

const publicRoutes = [
  '/login',
  '/register',
  '/forgot-password',
  '/setup-email',
  '/onboarding',
  '/accept-invite?token=e2e-warmup',
  '/reset-password/e2e-warmup-token',
  '/verify-email?token=e2e-warmup',
]

const authenticatedRoutes = [
  '/dashboard',
  '/profile',
  '/alerts',
  '/build-docs',
  '/build-docs/e2e-warmup',
  '/bundlers',
  '/certificate-checker',
  '/certificates',
  '/certificates/e2e-warmup',
  '/directory-lookup',
  '/hosts',
  '/hosts/e2e-warmup',
  '/hosts/bulk-tag',
  '/hosts/e2e-warmup/compare?with=e2e-warmup-other',
  '/hosts/groups',
  '/hosts/groups/e2e-warmup',
  '/hosts/networks',
  '/legal-notice',
  '/notifications',
  '/password-manager',
  '/reports/patch-status',
  '/reports/software',
  '/reports/vulnerabilities',
  '/runbooks',
  '/service-accounts',
  '/service-accounts/e2e-warmup',
  '/settings',
  '/settings/agents',
  '/settings/agents/defaults',
  '/settings/agents/software',
  '/settings/integrations',
  '/settings/integrations/smtp',
  '/settings/ldap',
  '/settings/licence',
  '/settings/monitoring',
  '/settings/monitoring/notifications',
  '/settings/monitoring/retention',
  '/settings/security',
  '/settings/security/terminal',
  '/settings/system',
  '/settings/tag-rules',
  '/tasks',
  '/tasks/e2e-warmup',
  '/tasks/schedules/new',
  '/tasks/schedules/e2e-warmup',
  '/team',
]

const authenticatedApiRoutes = [
  '/api/agent/latest',
  '/api/certificates',
  '/api/certificates/counts',
  '/api/domain-accounts',
  '/api/domain-accounts/counts',
  '/api/overview',
  '/api/service-accounts',
  '/api/service-accounts/counts',
  '/api/system/health',
]

setup.setTimeout(420_000)

setup('seed test organisation and warm Next routes', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be configured')

  await seedOrgAndUser()

  const publicContext = await browser.newContext()
  const publicPage = await publicContext.newPage()
  try {
    for (const route of publicRoutes) {
      const response = await publicPage.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (response && response.status() >= 500) {
        throw new Error(`Warmup navigation for ${route} failed with ${response.status()}`)
      }
    }
  } finally {
    await publicContext.close()
  }

  const storageState = await getStorageStatePath(baseURL)
  const context = await browser.newContext({ storageState })
  const page = await context.newPage()

  try {
    for (const route of authenticatedRoutes) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (response && response.status() >= 500) {
        throw new Error(`Warmup navigation for ${route} failed with ${response.status()}`)
      }
    }

    for (const route of authenticatedApiRoutes) {
      const response = await context.request.get(route)
      if (response.status() >= 500) {
        throw new Error(`Warmup request for ${route} failed with ${response.status()}`)
      }
    }
  } finally {
    await context.close()
  }
})
