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
const dashboardPageSource = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/dashboard/page.tsx'),
  'utf8',
)
const dashboardClientSource = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/dashboard/dashboard-client.tsx'),
  'utf8',
)
const settingsClientSource = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/settings/settings-client.tsx'),
  'utf8',
)
const licenceGuardSource = readFileSync(
  path.join(repoRoot, 'lib/actions/licence-guard.ts'),
  'utf8',
)
const sessionSource = readFileSync(
  path.join(repoRoot, 'lib/auth/session.ts'),
  'utf8',
)
const defaultInstanceSource = readFileSync(
  path.join(repoRoot, 'lib/default-instance.ts'),
  'utf8',
)
const usersActionSource = readFileSync(
  path.join(repoRoot, 'lib/actions/users.ts'),
  'utf8',
)
const teamPageSource = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/team/page.tsx'),
  'utf8',
)
const teamClientSource = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/team/team-client.tsx'),
  'utf8',
)
const loginFormSource = readFileSync(
  path.join(repoRoot, 'app/(auth)/login/login-form.tsx'),
  'utf8',
)
const registerFormSource = readFileSync(
  path.join(repoRoot, 'app/(auth)/register/register-form.tsx'),
  'utf8',
)
const topbarSource = readFileSync(
  path.join(repoRoot, 'components/shared/topbar.tsx'),
  'utf8',
)
const pendingApprovalCardSource = readFileSync(
  path.join(repoRoot, 'app/(setup)/pending-approval/pending-approval-card.tsx'),
  'utf8',
)
const seatLimitCardSource = readFileSync(
  path.join(repoRoot, 'app/(setup)/seat-limit-exceeded/seat-limit-exceeded-card.tsx'),
  'utf8',
)
const proxySource = readFileSync(
  path.join(repoRoot, 'proxy.ts'),
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
  'app/api/password-manager/launch-assertion/route.ts',
  'app/api/service-accounts/counts/route.ts',
  'app/api/service-accounts/route.ts',
  'app/api/system/health/route.ts',
]

const administrationPages = [
  'app/(dashboard)/settings/agents/defaults/page.tsx',
  'app/(dashboard)/settings/agents/page.tsx',
  'app/(dashboard)/settings/agents/software/page.tsx',
  'app/(dashboard)/settings/agents/tags/page.tsx',
  'app/(dashboard)/settings/integrations/ct-cve/page.tsx',
  'app/(dashboard)/settings/integrations/page.tsx',
  'app/(dashboard)/settings/integrations/smtp/page.tsx',
  'app/(dashboard)/settings/licence/page.tsx',
  'app/(dashboard)/settings/monitoring/notifications/page.tsx',
  'app/(dashboard)/settings/monitoring/page.tsx',
  'app/(dashboard)/settings/monitoring/retention/page.tsx',
  'app/(dashboard)/settings/page.tsx',
  'app/(dashboard)/settings/security/page.tsx',
  'app/(dashboard)/settings/security/terminal/page.tsx',
  'app/(dashboard)/settings/system/page.tsx',
]

test('dashboard shell falls back to community licence without instance-backed scope', () => {
  assert.match(
    dashboardLayoutSource,
    /getInstanceEffectiveLicence\(session\.user\.instanceId\)/,
  )
  assert.doesNotMatch(dashboardLayoutSource, /throw new Error\('Instance scope is not configured'\)/)
  assert.match(licenceGuardSource, /if \(!scopeId\) return getCommunityLicence\(\)/)
})

test('overview API returns empty counts for a fresh standalone instance', () => {
  assert.match(overviewRouteSource, /getApiSession\(\)/)
  assert.doesNotMatch(overviewRouteSource, /getApiInstanceSession\(\)/)
  assert.match(overviewRouteSource, /if \(!instanceId\) \{\s*return Response\.json\(emptyOverview\)\s*\}/)
})

test('dashboard overview uses the instance display name for page context', () => {
  assert.match(dashboardPageSource, /getInstanceDisplayName\(session\.user\.instanceId\)/)
  assert.match(dashboardPageSource, /absolute: `Overview \| \$\{instanceName\}`/)
  assert.match(dashboardClientSource, /instanceName: string/)
  assert.match(dashboardClientSource, /data-testid="dashboard-instance-name"/)
})

test('licence activation panel shows instance purchase context', () => {
  assert.match(settingsClientSource, /data-testid="licence-instance-name"/)
  assert.match(settingsClientSource, /data-testid="licence-instance-id"/)
  assert.match(settingsClientSource, /\{instance\.name\}/)
  assert.match(settingsClientSource, /\{instance\.id\}/)
})

test('sidebar-linked pages do not force an instance-backed action scope', () => {
  for (const relativePath of sidebarLinkedPages) {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
    assert.doesNotMatch(
      source,
      /resolveCurrentActionScope\(session\)/,
      `${relativePath} should use an optional scope or empty standalone state`,
    )
    assert.doesNotMatch(
      source,
      /session\.user\.instanceId!/,
      `${relativePath} should not assert an instance id during initial render`,
    )
  }
})

test('standalone sidebar APIs use regular session auth and empty no-instance fallbacks', () => {
  for (const relativePath of standaloneApiRoutes) {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
    assert.match(source, /getApiSession\(/, `${relativePath} should allow no-instance sessions`)
    assert.doesNotMatch(source, /getApiInstance(Admin)?Session\(/)
  }
})

test('fresh standalone sessions promote the first active user to instance admin', () => {
  assert.match(sessionSource, /ensureInstanceHasSuperAdmin\(user\)/)
  assert.match(sessionSource, /activeUsers\[0\]\?\.id !== user\.id/)
  assert.match(sessionSource, /set\(\{ role: INSTANCE_ADMIN_ROLE, roles, updatedAt: new Date\(\) \}\)/)
})

test('configured standalone installs create a default instance scope', () => {
  assert.match(defaultInstanceSource, /process\.env\['CT_OPS_INSTANCE_ID'\]/)
  assert.match(defaultInstanceSource, /\.insert\(instanceSettings\)/)
  assert.match(defaultInstanceSource, /onConflictDoNothing\(\)/)
  assert.match(sessionSource, /user\.instanceId \?\? await getDefaultInstanceId\(\)/)
})

test('team invitations are disabled without an instance-backed scope', () => {
  assert.match(usersActionSource, /const currentScope = resolveOptionalActionScope\(session\)/)
  assert.match(
    usersActionSource,
    /if \(!currentScope\) return \{ error: 'Team invitations require an instance to be configured' \}/,
  )
  assert.match(teamPageSource, /hasInstanceScope=\{Boolean\(session\.user\.instanceId\)\}/)
  assert.match(teamClientSource, /hasInstanceScope: boolean/)
  assert.match(teamClientSource, /canManage\(currentUserRole\) && hasInstanceScope/)
})

test('people administration claims unscoped direct signups as pending members', () => {
  assert.match(usersActionSource, /async function claimDirectSignupUsers\(instanceId: string\): Promise<void>/)
  assert.match(usersActionSource, /WHERE u\.instance_id IS NULL/)
  assert.match(usersActionSource, /ELSE 'pending'/)
  assert.match(usersActionSource, /ELSE '\[\]'::jsonb/)
  assert.doesNotMatch(usersActionSource, /NOT EXISTS \(\s*SELECT 1\s*FROM invitations AS i/)
  assert.match(usersActionSource, /await claimDirectSignupUsers\(currentScope\)/)
})

test('people administration keeps the member list fresh after invite conflicts', () => {
  assert.match(teamClientSource, /refetchOnMount: 'always'/)
  assert.match(teamClientSource, /refetchOnWindowFocus: 'always'/)
  assert.match(teamClientSource, /refetchInterval: 15_000/)
  assert.match(teamClientSource, /onSettled: invalidate/)
})

test('auth transitions use fresh document navigations and no-store responses', () => {
  for (const [name, source] of [
    ['login form', loginFormSource],
    ['register form', registerFormSource],
    ['topbar sign out', topbarSource],
    ['pending approval sign out', pendingApprovalCardSource],
    ['seat-limit sign out', seatLimitCardSource],
  ]) {
    assert.match(source, /navigateWithFreshDocument/, `${name} should avoid cached App Router transitions`)
    assert.doesNotMatch(source, /router\.push\((inviteAcceptPath \?\? )?'\/dashboard'\)/, `${name} should not soft-navigate after auth changes`)
    assert.doesNotMatch(source, /router\.push\('\/login'\)/, `${name} should not soft-navigate after sign-out`)
  }

  assert.match(proxySource, /NO_STORE_CACHE_CONTROL/)
  assert.match(proxySource, /applyNoStoreHeaders\(response\)/)
  assert.match(proxySource, /isSessionScopedRoute/)
})

test('role assignment can claim pending users that signed up outside the instance scope', () => {
  assert.match(usersActionSource, /const targetUserWhere = or\(/)
  assert.match(usersActionSource, /and\(eq\(users\.id, targetUserId\), isNull\(users\.instanceId\), eq\(users\.role, 'pending'\), isNull\(users\.deletedAt\)\)/)
  assert.match(usersActionSource, /set\(\{ instanceId, role: nextRole, roles: nextRoles, updatedAt: new Date\(\) \}\)/)
})

test('administration pages use normalized role checks', () => {
  for (const relativePath of administrationPages) {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8')
    assert.match(source, /hasRole\(session\.user, \['instance_admin', 'super_admin'\]\)/)
    assert.doesNotMatch(
      source,
      /ADMIN_ROLES\.includes\(session\.user\.role\)|session\.user\.role === 'super_admin'|\['instance_admin', 'super_admin'\]\.includes\(session\.user\.role\)/,
      `${relativePath} should not depend on the primary legacy role string`,
    )
  }
})
