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
