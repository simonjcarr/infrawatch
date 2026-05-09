import { test as setup, type APIRequestContext, type Page } from '@playwright/test'
import { getStorageStatePath } from './fixtures/auth'
import { seedOrgAndUser } from './fixtures/seed'

const publicRoutes = [
  '/login',
  '/register',
  '/forgot-password',
  '/setup-email',
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
  '/calendar',
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
  '/password-generator',
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

const routeWarmupTimeoutMs = 120_000
const routeSettleTimeoutMs = 10_000
const setupTimeoutMs = 30 * 60_000

setup.setTimeout(setupTimeoutMs)

function isIgnorableWarmupError(err: unknown): boolean {
  if (!(err instanceof Error)) return false

  return err.name === 'TimeoutError' || err.message.includes('net::ERR_ABORTED')
}

async function warmupNavigation(page: Page, route: string): Promise<void> {
  let response
  try {
    response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: routeWarmupTimeoutMs })
  } catch (err) {
    if (isIgnorableWarmupError(err)) {
      console.warn(`[e2e] warmup navigation for ${route} was interrupted: ${String(err)}`)
      return
    }
    throw err
  }
  if (response && response.status() >= 500) {
    throw new Error(`Warmup navigation for ${route} failed with ${response.status()}`)
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: routeSettleTimeoutMs })
  } catch (err) {
    if (isIgnorableWarmupError(err)) {
      console.warn(`[e2e] warmup navigation for ${route} did not settle: ${String(err)}`)
      return
    }
    throw err
  }
}

async function warmupRequest(request: APIRequestContext, route: string): Promise<void> {
  let response
  try {
    response = await request.get(route, { timeout: routeWarmupTimeoutMs })
  } catch (err) {
    if (isIgnorableWarmupError(err)) {
      console.warn(`[e2e] warmup request for ${route} was interrupted: ${String(err)}`)
      return
    }
    throw err
  }
  if (response.status() >= 500) {
    throw new Error(`Warmup request for ${route} failed with ${response.status()}`)
  }
}

setup('seed test organisation and warm Next routes', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('baseURL must be configured')

  await seedOrgAndUser()

  const publicContext = await browser.newContext()
  const publicPage = await publicContext.newPage()
  try {
    for (const route of publicRoutes) {
      await warmupNavigation(publicPage, route)
    }
  } finally {
    await publicContext.close()
  }

  const storageState = await getStorageStatePath(baseURL)
  const context = await browser.newContext({ storageState })
  const page = await context.newPage()

  try {
    for (const route of authenticatedRoutes) {
      await warmupNavigation(page, route)
    }

    for (const route of authenticatedApiRoutes) {
      await warmupRequest(context.request, route)
    }
  } finally {
    await context.close()
  }
})
