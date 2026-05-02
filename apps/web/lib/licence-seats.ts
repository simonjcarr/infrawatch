export type SeatUsageInput = {
  activeUsers: number
  pendingInvites: number
  maxUsers?: number
}

export const FREE_INCLUDED_USER_SEATS = 3

export type SeatUsage = SeatUsageInput & {
  usedSeats: number
  remainingSeats?: number
}

export function calculateSeatUsage(input: SeatUsageInput): SeatUsage {
  const usedSeats = input.activeUsers + input.pendingInvites
  const maxUsers = input.maxUsers ?? FREE_INCLUDED_USER_SEATS
  return {
    ...input,
    maxUsers,
    usedSeats,
    remainingSeats: Math.max(maxUsers - usedSeats, 0),
  }
}

export function canReserveSeats(usage: SeatUsage, seats = 1): boolean {
  return usage.usedSeats + seats <= (usage.maxUsers ?? FREE_INCLUDED_USER_SEATS)
}

export function formatSeatLimitError(usage: Pick<SeatUsage, 'maxUsers'>): string {
  const seats = usage.maxUsers ?? 0
  return `User seat limit reached. This licence allows ${seats} ${seats === 1 ? 'user' : 'users'}.`
}
