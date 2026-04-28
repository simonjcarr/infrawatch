import test from 'node:test'
import assert from 'node:assert/strict'

import { createInMemoryThrottleStore } from './throttle-store.ts'
import { createRateLimiter } from './rate-limit.ts'

test('rate limiter shares state across instances when backed by the same store', async () => {
  const store = createInMemoryThrottleStore()
  const limiterA = createRateLimiter({
    scope: 'test:shared-rate-limit',
    windowMs: 60_000,
    max: 3,
    store,
  })
  const limiterB = createRateLimiter({
    scope: 'test:shared-rate-limit',
    windowMs: 60_000,
    max: 3,
    store,
  })

  assert.equal(await limiterA.check('203.0.113.10'), true)
  assert.equal(await limiterB.check('203.0.113.10'), true)
  assert.equal(await limiterA.check('203.0.113.10'), true)
  assert.equal(await limiterB.check('203.0.113.10'), false)
})
