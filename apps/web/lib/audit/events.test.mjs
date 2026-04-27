import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAuditEventValues, serialiseAuditMetadata } from './events-core.ts'

test('serialiseAuditMetadata normalises dates, bigint values, and nested records', () => {
  const now = new Date('2026-04-27T12:00:00.000Z')
  const result = serialiseAuditMetadata({
    when: now,
    count: 3n,
    nested: {
      ok: true,
      skip: undefined,
    },
    list: ['a', now, Symbol('skip')],
  })

  assert.deepEqual(result, {
    when: '2026-04-27T12:00:00.000Z',
    count: '3',
    nested: { ok: true },
    list: ['a', '2026-04-27T12:00:00.000Z'],
  })
})

test('buildAuditEventValues drops empty metadata and preserves nullable targets', () => {
  const values = buildAuditEventValues({
    organisationId: 'org-1',
    actorUserId: 'user-1',
    action: 'licence.updated',
    targetType: 'organisation',
    summary: 'Updated licence tier',
    metadata: undefined,
  })

  assert.equal(values.targetId, null)
  assert.equal(values.metadata, null)
  assert.equal(values.summary, 'Updated licence tier')
})
