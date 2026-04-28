import type { ThrottleStore } from './throttle-store'

export interface RateLimiter {
  /** Returns true if the request is allowed, false if it should be rejected. */
  check(key: string, now?: number): Promise<boolean>
}

export function createRateLimiter(options: {
  scope: string
  windowMs: number
  max: number
  store?: ThrottleStore
}): RateLimiter {
  async function getStore(): Promise<ThrottleStore> {
    if (options.store) return options.store
    return (await import('./db-throttle-store')).dbThrottleStore
  }

  return {
    async check(key: string, now = Date.now()): Promise<boolean> {
      const store = await getStore()
      return store.transact(options.scope, key, (state) => {
        const cutoff = now - options.windowMs
        const hits = state.hits.filter((timestamp) => timestamp > cutoff)
        if (hits.length >= options.max) {
          return {
            result: false,
            state: { ...state, hits },
          }
        }

        hits.push(now)
        return {
          result: true,
          state: { ...state, hits },
        }
      })
    },
  }
}
