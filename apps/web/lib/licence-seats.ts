export type SeatUsageInput = {
  activeUsers: number
  pendingInvites: number
  maxUsers?: number
}

export type SeatUsage = SeatUsageInput & {
  usedSeats: number
  remainingSeats?: number
}

export function calculateSeatUsage(input: SeatUsageInput): SeatUsage {
  const usedSeats = input.activeUsers + input.pendingInvites
  return {
    ...input,
    usedSeats,
    remainingSeats: input.maxUsers === undefined ? undefined : Math.max(input.maxUsers - usedSeats, 0),
  }
}

export function canReserveSeats(usage: SeatUsage, seats = 1): boolean {
  if (usage.maxUsers === undefined) return true
  return usage.usedSeats + seats <= usage.maxUsers
}

export function formatSeatLimitError(usage: Pick<SeatUsage, 'maxUsers'>): string {
  const seats = usage.maxUsers ?? 0
  return `User seat limit reached. This licence allows ${seats} ${seats === 1 ? 'user' : 'users'}.`
}
