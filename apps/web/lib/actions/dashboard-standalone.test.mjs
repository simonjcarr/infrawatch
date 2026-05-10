import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dashboardLayoutSource = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/layout.tsx'),
  'utf8',
)
const overviewRouteSource = readFileSync(
  path.join(repoRoot, 'app/api/overview/route.ts'),
  'utf8',
)
const licenceGuardSource = readFileSync(
  path.join(repoRoot, 'lib/actions/licence-guard.ts'),
  'utf8',
)

const sidebarLinkedPages = [
  'app/(dashboard)/alerts/page.tsx',
  'app/(dashboard)/build-docs/page.tsx',
  'app/(dashboard)/bundlers/page.tsx',
  'app/(dashboard)/calendar/page.tsx',
  'app/(dashboard)/certificate-checker/page.tsx',
  'app/(dashboard)/certificates/page.tsx',
  'app/(dashboard)/dashboard/page.tsx',
  'app/(dashboard)/directory-lookup/page.tsx',
  'app/(dashboard)/hosts/groups/page.tsx',
  'app/(dashboard)/hosts/networks/page.tsx',
  'app/(dashboard)/hosts/page.tsx',
  'app/(dashboard)/notifications/page.tsx',
  'app/(dashboard)/password-generator/page.tsx',
  'app/(dashboard)/password-manager/page.tsx',
  'app/(dashboard)/reports/patch-status/page.tsx',
  'app/(dashboard)/reports/software/page.tsx',
  'app/(dashboard)/reports/vulnerabilities/page.tsx',
  'app/(dashboard)/service-accounts/page.tsx',
  'app/(dashboard)/settings/agents/page.tsx',
  'app/(dashboard)/settings/integrations/page.tsx',
  'app/(dashboard)/settings/monitoring/page.tsx',
  'app/(dashboard)/settings/page.tsx',
  'app/(dashboard)/settings/security/page.tsx',
  'app/(dashboard)/settings/system/page.tsx',
  'app/(dashboard)/tasks/page.tsx',
  'app/(dashboard)/team/page.tsx',
]

const standaloneApiRoutes = [
  'app/api/certificates/counts/route.ts',
  'app/api/certificates/route.ts',
  'app/api/domain-accounts/counts/route.ts',
  'app/api/domain-accounts/route.ts',
  'app/api/overview/route.ts',
  'app/api/service-accounts/counts/route.ts',
  'app/api/service-accounts/route.ts',
  'app/api/system/health/route.ts',
]

test('dashboard shell falls back to community licence without org-backed scope', () => {
  assert.match(
    dashboardLayoutSource,
    /getInstanceEffectiveLicence\(session\.user\.organisationId\)/,
  )
  assert.doesNotMatch(dashboardLayoutSource, /throw new Error\('Instance scope is not configured'\)/)
  assert.match(licenceGuardSource, /if \(!scopeId\) return getCommunityLicence\(\)/)
})

test('overview API returns empty counts for a fresh standalone instance', () => {
  assert.match(overviewRouteSource, /getApiSession\(\)/)
  assert.doesNotMatch(overviewRouteSource, /getApiOrgSession\(\)/)
  assert.match(overviewRouteSource, /if \(!orgId\) \{\s*return Response\.json\(emptyOverview\)\s*\}/)
})

test('sidebar-linked pages do not force an organisation-backed action scope', () => {
  for (const relativePath of sidebarLinkedPages) {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
    assert.doesNotMatch(
      source,
      /resolveCurrentActionScope\(session\)/,
      `${relativePath} should use an optional scope or empty standalone state`,
    )
    assert.doesNotMatch(
      source,
      /session\.user\.organisationId!/,
      `${relativePath} should not assert an organisation id during initial render`,
    )
  }
})

test('standalone sidebar APIs use regular session auth and empty no-org fallbacks', () => {
  for (const relativePath of standaloneApiRoutes) {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
    assert.match(source, /getApiSession\(/, `${relativePath} should allow no-org sessions`)
    assert.doesNotMatch(source, /getApiOrg(Admin)?Session\(/)
  }
})
