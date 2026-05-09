import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const agentsSource = readFileSync(path.join(here, 'agents-core.ts'), 'utf8')
const alertsSource = readFileSync(path.join(here, 'alerts.ts'), 'utf8')

function getActionSegment(source, action) {
  const start = source.lastIndexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('privileged agent actions derive audit actors from the authenticated session', () => {
  for (const action of ['approveAgent', 'rejectAgent', 'createEnrolmentToken']) {
    const segment = getActionSegment(agentsSource, action)

    assert.doesNotMatch(
      segment.slice(0, segment.indexOf('): Promise')),
      /\b(?:actorId|userId)\s*:/,
      `${action} must not accept caller-controlled actor or user identifiers`,
    )
    assert.match(
      segment,
      /const session = await requireOrgToolingAccess\(orgId\)/,
      `${action} must capture the tooling-authorized session`,
    )
  }
})

test('alert mutations derive audit actors from the authenticated session', () => {
  for (const action of ['acknowledgeAlert', 'createSilence']) {
    const segment = getActionSegment(alertsSource, action)

    assert.doesNotMatch(
      segment.slice(0, segment.indexOf('): Promise')),
      /\buserId\s*:/,
      `${action} must not accept a caller-controlled userId`,
    )
    assert.match(
      segment,
      /const session = await requireOrg(?:Access|WriteAccess)\(orgId\)/,
      `${action} must capture the authenticated session`,
    )
    assert.match(
      segment,
      /session\.user\.id/,
      `${action} must write identity fields from session.user.id`,
    )
  }
})
