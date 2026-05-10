import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mapPasswordManagerCryptoBatch,
  mapPasswordManagerCryptoBatchSettled,
} from './crypto-batch.ts'

test('mapPasswordManagerCryptoBatch preserves order across async batches', async () => {
  const values = await mapPasswordManagerCryptoBatch([1, 2, 3], 2, async (value) => value * 2)

  assert.deepEqual(values, [2, 4, 6])
})

test('mapPasswordManagerCryptoBatchSettled keeps fulfilled records when one item fails', async () => {
  const results = await mapPasswordManagerCryptoBatchSettled([1, 2, 3], 2, async (value) => {
    if (value === 2) {
      throw new Error('stale wrapped key')
    }
    return `vault-${value}`
  })

  assert.deepEqual(results.fulfilled, [
    { input: 1, value: 'vault-1' },
    { input: 3, value: 'vault-3' },
  ])
  assert.equal(results.rejected.length, 1)
  assert.equal(results.rejected[0].input, 2)
  assert.match(results.rejected[0].reason.message, /stale wrapped key/)
})
