import test from 'node:test'
import assert from 'node:assert/strict'

import { selectAdmittedSeatUserIds } from './seat-selection.ts'

function user(id, role, createdAt, roles = [role]) {
  return { id, role, roles, createdAt: new Date(createdAt) }
}

test('seat admission preserves a super admin before pinned free-seat users', () => {
  const activeUsers = [
    user('engineer_1', 'engineer', '2026-01-01T00:00:00Z'),
    user('engineer_2', 'engineer', '2026-01-02T00:00:00Z'),
    user('admin_1', 'super_admin', '2026-01-03T00:00:00Z'),
    user('engineer_3', 'engineer', '2026-01-04T00:00:00Z'),
  ]

  assert.deepEqual(
    selectAdmittedSeatUserIds(activeUsers, ['engineer_1', 'engineer_2', 'engineer_3'], 3),
    ['admin_1', 'engineer_1', 'engineer_2'],
  )
})

test('seat admission falls back to an org admin when no super admin exists', () => {
  const activeUsers = [
    user('engineer_1', 'engineer', '2026-01-01T00:00:00Z'),
    user('admin_1', 'org_admin', '2026-01-03T00:00:00Z'),
    user('engineer_2', 'engineer', '2026-01-04T00:00:00Z'),
  ]

  assert.deepEqual(
    selectAdmittedSeatUserIds(activeUsers, [], 2),
    ['admin_1', 'engineer_1'],
  )
})

test('seat admission fills remaining seats by oldest active users', () => {
  const activeUsers = [
    user('newer', 'engineer', '2026-01-03T00:00:00Z'),
    user('older', 'engineer', '2026-01-01T00:00:00Z'),
    user('oldest', 'engineer', '2025-12-31T00:00:00Z'),
  ]

  assert.deepEqual(
    selectAdmittedSeatUserIds(activeUsers, [], 2),
    ['oldest', 'older'],
  )
})
