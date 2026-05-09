import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const checksSource = readFileSync(path.join(here, 'checks-core.ts'), 'utf8')

function getActionSegment(action) {
  const start = checksSource.indexOf(`export async function ${action}`)
  assert.notEqual(start, -1, `expected ${action} to exist in checks-core.ts`)
  const next = checksSource.indexOf('\nexport async function ', start + 1)
  return checksSource.slice(start, next === -1 ? undefined : next)
}

test('createCheck validates the target host belongs to the organisation before insert', () => {
  const segment = getActionSegment('createCheck')
  const hostLookupIndex = segment.indexOf('db.query.hosts.findFirst')
  const insertIndex = segment.indexOf('.insert(checks)')

  assert.notEqual(hostLookupIndex, -1, 'createCheck must look up the host before inserting a check')
  assert.notEqual(insertIndex, -1, 'createCheck must insert the validated check')
  assert.ok(hostLookupIndex < insertIndex, 'host ownership must be validated before insert')
  assert.match(segment, /eq\(hosts\.id, data\.hostId\)/, 'host lookup must use the requested host ID')
  assert.match(segment, /eq\(hosts\.organisationId, orgId\)/, 'host lookup must be scoped to the caller organisation')
  assert.match(segment, /isNull\(hosts\.deletedAt\)/, 'host lookup must reject soft-deleted hosts')
  assert.match(segment, /if \(!host\) return \{ error: 'Host not found' \}/, 'missing or cross-tenant hosts must fail closed')
})
