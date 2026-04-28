import type { ThrottleStore } from '../throttle-store'

export interface LoginAttemptGuardOptions {
  scope: string
  windowMs: number
  maxFailures: number
  baseLockoutMs: number
  maxLockoutMs: number
  store?: ThrottleStore
}

export interface LoginAttemptStatus {
  allowed: boolean
  retryAfterMs: number
}

function pruneFailures(failures: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  return failures.filter((timestamp) => timestamp > cutoff)
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

export function createLoginAttemptGuard(options: LoginAttemptGuardOptions) {
  async function getStore(): Promise<ThrottleStore> {
    if (options.store) return options.store
    return (await import('../db-throttle-store')).dbThrottleStore
  }

  function normaliseIdentifier(rawIdentifier: string): string | null {
    const identifier = normalizeIdentifier(rawIdentifier)
    return identifier || null
  }

  return {
    async check(identifier: string, now = Date.now()): Promise<LoginAttemptStatus> {
      const normalized = normaliseIdentifier(identifier)
      if (!normalized) return { allowed: true, retryAfterMs: 0 }

      const store = await getStore()
      return store.transact<LoginAttemptStatus>(options.scope, normalized, (state) => {
        const next = {
          ...state,
          hits: pruneFailures(state.hits, options.windowMs, now),
          lockedUntil: state.lockedUntil > now ? state.lockedUntil : 0,
        }

        if (next.lockedUntil > now) {
          return {
            result: {
              allowed: false,
              retryAfterMs: next.lockedUntil - now,
            },
            state: next,
          }
        }

        return {
          result: { allowed: true, retryAfterMs: 0 },
          state: next,
        }
      })
    },

    async recordFailure(identifier: string, now = Date.now()): Promise<LoginAttemptStatus> {
      const normalized = normaliseIdentifier(identifier)
      if (!normalized) return { allowed: true, retryAfterMs: 0 }

      const store = await getStore()
      return store.transact<LoginAttemptStatus>(options.scope, normalized, (state) => {
        const hits = pruneFailures(state.hits, options.windowMs, now)
        hits.push(now)

        if (hits.length < options.maxFailures) {
          return {
            result: { allowed: true, retryAfterMs: 0 },
            state: { ...state, hits },
          }
        }

        const lockoutLevel = state.lockoutLevel + 1
        const lockoutMs = Math.min(
          options.baseLockoutMs * 2 ** (lockoutLevel - 1),
          options.maxLockoutMs,
        )
        return {
          result: {
            allowed: false,
            retryAfterMs: lockoutMs,
          },
          state: {
            hits: [],
            lockoutLevel,
            lockedUntil: now + lockoutMs,
          },
        }
      })
    },

    async reset(identifier: string): Promise<void> {
      const normalized = normaliseIdentifier(identifier)
      if (!normalized) return
      const store = await getStore()
      await store.clear(options.scope, normalized)
    },
  }
}

export const passwordLoginAttemptGuard = createLoginAttemptGuard({
  scope: 'auth:password-login',
  windowMs: 15 * 60_000,
  maxFailures: 5,
  baseLockoutMs: 5 * 60_000,
  maxLockoutMs: 60 * 60_000,
})
