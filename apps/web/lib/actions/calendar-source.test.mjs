import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, 'calendar.ts'), 'utf8')

function getActionSegment(action) {
  const start = source.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('calendar mutations require write access but list requires org access', () => {
  assert.match(getActionSegment('listCalendarEvents'), /await requireInstanceAccess\(instanceId\)/)

  for (const action of [
    'createCalendarEvent',
    'updateCalendarEvent',
    'deleteCalendarEvent',
    'moveCalendarEventInstance',
  ]) {
    assert.match(
      getActionSegment(action),
      /await requireInstanceWriteAccess\(instanceId\)/,
      `${action} must allow engineers and admins while blocking read-only users`,
    )
  }
})

test('calendar create is idempotent and guarded by a mutation rate limiter', () => {
  const segment = getActionSegment('createCalendarEvent')

  assert.match(segment, /clientRequestId/)
  assert.match(segment, /checkMutationLimit\(instanceId, session\.user\.id\)/)
  assert.match(segment, /existingIdempotentEvent/)
})

test('calendar mutations write audit events', () => {
  for (const action of [
    'createCalendarEvent',
    'updateCalendarEvent',
    'deleteCalendarEvent',
    'moveCalendarEventInstance',
  ]) {
    assert.match(getActionSegment(action), /writeAuditEvent\(/, `${action} must write an audit event`)
  }
})
