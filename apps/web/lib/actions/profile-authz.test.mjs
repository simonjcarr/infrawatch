import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const profileSource = readFileSync(path.join(here, 'profile.ts'), 'utf8')

function getActionSegment(action) {
  const start = profileSource.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist`)
  const next = profileSource.indexOf('\nexport async function ', start + 1)
  return profileSource.slice(start, next === -1 ? undefined : next)
}

test('profile self-service actions derive the target user from the authenticated session', () => {
  for (const action of ['updateName', 'updateEmail', 'updateTheme']) {
    const segment = getActionSegment(action)
    const signature = segment.slice(0, segment.indexOf('): Promise'))

    assert.doesNotMatch(
      signature,
      /\buserId\s*:/,
      `${action} must not accept a caller-controlled userId`,
    )
    assert.match(
      segment,
      /const session = await getRequiredSession\(\)/,
      `${action} must authenticate and load the session`,
    )
    assert.match(
      segment,
      /session\.user\.id/,
      `${action} must update the authenticated session user`,
    )
  }
})

test('notification preference action derives user and organisation from the authenticated session', () => {
  const segment = getActionSegment('updateNotificationPreference')
  const signature = segment.slice(0, segment.indexOf('): Promise'))

  assert.doesNotMatch(
    signature,
    /\b(?:userId|orgId)\s*:/,
    'updateNotificationPreference must not accept caller-controlled userId or orgId',
  )
  assert.match(
    segment,
    /const session = await getRequiredSession\(\)/,
    'updateNotificationPreference must authenticate and load the session',
  )
  assert.match(
    segment,
    /session\.user\.id/,
    'updateNotificationPreference must update the authenticated session user',
  )
  assert.match(
    segment,
    /session\.user\.organisationId/,
    'updateNotificationPreference must read organisation policy from the authenticated session organisation',
  )
})
