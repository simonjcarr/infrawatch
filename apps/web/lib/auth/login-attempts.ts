export interface LoginAttemptGuardOptions {
  windowMs: number
  maxFailures: number
  baseLockoutMs: number
  maxLockoutMs: number
}

export interface LoginAttemptStatus {
  allowed: boolean
  retryAfterMs: number
}

interface AttemptState {
  failures: number[]
  lockoutLevel: number
  lockedUntil: number
}

function pruneFailures(failures: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  return failures.filter((timestamp) => timestamp > cutoff)
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

export function createLoginAttemptGuard(options: LoginAttemptGuardOptions) {
  const state = new Map<string, AttemptState>()

  function getState(rawIdentifier: string, now = Date.now()): [string, AttemptState] | null {
    const identifier = normalizeIdentifier(rawIdentifier)
    if (!identifier) return null

    const existing = state.get(identifier)
    const next: AttemptState = existing
      ? {
          failures: pruneFailures(existing.failures, options.windowMs, now),
          lockoutLevel: existing.lockoutLevel,
          lockedUntil: existing.lockedUntil,
        }
      : {
          failures: [],
          lockoutLevel: 0,
          lockedUntil: 0,
        }

    state.set(identifier, next)
    return [identifier, next]
  }

  return {
    check(identifier: string, now = Date.now()): LoginAttemptStatus {
      const entry = getState(identifier, now)
      if (!entry) return { allowed: true, retryAfterMs: 0 }

      const [, current] = entry
      if (current.lockedUntil > now) {
        return {
          allowed: false,
          retryAfterMs: current.lockedUntil - now,
        }
      }

      if (current.lockedUntil !== 0) {
        current.lockedUntil = 0
      }

      return { allowed: true, retryAfterMs: 0 }
    },

    recordFailure(identifier: string, now = Date.now()): LoginAttemptStatus {
      const entry = getState(identifier, now)
      if (!entry) return { allowed: true, retryAfterMs: 0 }

      const [, current] = entry
      current.failures.push(now)

      if (current.failures.length < options.maxFailures) {
        return { allowed: true, retryAfterMs: 0 }
      }

      current.failures = []
      current.lockoutLevel += 1
      const lockoutMs = Math.min(
        options.baseLockoutMs * 2 ** (current.lockoutLevel - 1),
        options.maxLockoutMs,
      )
      current.lockedUntil = now + lockoutMs

      return {
        allowed: false,
        retryAfterMs: lockoutMs,
      }
    },

    reset(identifier: string): void {
      const normalized = normalizeIdentifier(identifier)
      if (!normalized) return
      state.delete(normalized)
    },
  }
}

export const passwordLoginAttemptGuard = createLoginAttemptGuard({
  windowMs: 15 * 60_000,
  maxFailures: 5,
  baseLockoutMs: 5 * 60_000,
  maxLockoutMs: 60 * 60_000,
})
