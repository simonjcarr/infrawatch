/**
 * Simple per-process sliding-window rate limiter.
 * Suitable for single-node deployments; multi-node needs Redis.
 */
export interface RateLimiter {
  /** Returns true if the request is allowed, false if it should be rejected. */
  check(key: string): boolean
}

export function createRateLimiter(windowMs: number, max: number): RateLimiter {
  const store = new Map<string, number[]>()
  return {
    check(key: string): boolean {
      const now = Date.now()
      const cutoff = now - windowMs
      const hits = (store.get(key) ?? []).filter((t) => t > cutoff)
      if (hits.length >= max) return false
      hits.push(now)
      store.set(key, hits)
      return true
    },
  }
}
