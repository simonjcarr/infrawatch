import { hasRole } from './auth/guards.ts'

export type SeatSelectionUser = {
  id: string
  role: string
  roles?: string[]
  createdAt: Date
}

function pushUnique(target: string[], seen: Set<string>, userId: string, maxUsers: number): void {
  if (target.length >= maxUsers || seen.has(userId)) return
  target.push(userId)
  seen.add(userId)
}

function byCreatedAtThenId(a: SeatSelectionUser, b: SeatSelectionUser): number {
  const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime()
  if (byCreatedAt !== 0) return byCreatedAt
  return a.id.localeCompare(b.id)
}

export function selectAdmittedSeatUserIds(
  activeUsers: SeatSelectionUser[],
  pinnedUserIds: readonly string[],
  maxUsers: number,
): string[] {
  if (maxUsers <= 0) return []
  const byId = new Map(activeUsers.map((user) => [user.id, user]))
  const sortedUsers = [...activeUsers].sort(byCreatedAtThenId)
  const admitted: string[] = []
  const seen = new Set<string>()

  const firstAdmin = sortedUsers.find((user) => hasRole(user, 'super_admin'))
    ?? sortedUsers.find((user) => hasRole(user, 'instance_admin'))
  if (firstAdmin) {
    pushUnique(admitted, seen, firstAdmin.id, maxUsers)
  }

  for (const userId of pinnedUserIds) {
    if (byId.has(userId)) {
      pushUnique(admitted, seen, userId, maxUsers)
    }
  }

  for (const user of sortedUsers) {
    if (hasRole(user, ['super_admin', 'instance_admin'])) {
      pushUnique(admitted, seen, user.id, maxUsers)
    }
  }

  for (const user of sortedUsers) {
    pushUnique(admitted, seen, user.id, maxUsers)
  }

  return admitted
}
