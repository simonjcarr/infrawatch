import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateSeatUsage,
  canReserveSeats,
  formatSeatLimitError,
} from './licence-seats.ts'

test('calculateSeatUsage counts active users and pending invites only', () => {
  const usage = calculateSeatUsage({
    activeUsers: 2,
    pendingInvites: 1,
    maxUsers: 4,
  })

  assert.deepEqual(usage, {
    activeUsers: 2,
    pendingInvites: 1,
    usedSeats: 3,
    maxUsers: 4,
    remainingSeats: 1,
  })
})

test('canReserveSeats allows usage below the max user capacity', () => {
  const usage = calculateSeatUsage({
    activeUsers: 1,
    pendingInvites: 1,
    maxUsers: 3,
  })

  assert.equal(canReserveSeats(usage, 1), true)
})

test('canReserveSeats blocks reservations that would exceed maxUsers', () => {
  const usage = calculateSeatUsage({
    activeUsers: 2,
    pendingInvites: 1,
    maxUsers: 3,
  })

  assert.equal(canReserveSeats(usage, 1), false)
  assert.equal(formatSeatLimitError(usage), 'User seat limit reached. This licence allows 3 users.')
})

test('canReserveSeats treats a missing maxUsers claim as unlimited for this compatibility phase', () => {
  const usage = calculateSeatUsage({
    activeUsers: 200,
    pendingInvites: 40,
  })

  assert.equal(canReserveSeats(usage, 1), true)
  assert.equal(usage.remainingSeats, undefined)
})
