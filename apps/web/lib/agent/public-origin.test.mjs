import test from 'node:test'
import assert from 'node:assert/strict'

import { getAgentPublicOrigin } from './public-origin.ts'

test('getAgentPublicOrigin prefers AGENT_DOWNLOAD_BASE_URL over BETTER_AUTH_URL', () => {
  assert.equal(
    getAgentPublicOrigin({
      AGENT_DOWNLOAD_BASE_URL: 'https://agents.ct-ops.example.com/downloads/',
      BETTER_AUTH_URL: 'https://app.ct-ops.example.com/login',
    }),
    'https://agents.ct-ops.example.com',
  )
})

test('getAgentPublicOrigin falls back to BETTER_AUTH_URL', () => {
  assert.equal(
    getAgentPublicOrigin({
      BETTER_AUTH_URL: 'https://ct-ops.example.com/dashboard?tab=agents',
    }),
    'https://ct-ops.example.com',
  )
})

test('getAgentPublicOrigin rejects missing canonical origin configuration', () => {
  assert.throws(
    () => getAgentPublicOrigin({}),
    /AGENT_DOWNLOAD_BASE_URL or BETTER_AUTH_URL must be set/,
  )
})

test('getAgentPublicOrigin rejects invalid canonical origin configuration', () => {
  assert.throws(
    () => getAgentPublicOrigin({ AGENT_DOWNLOAD_BASE_URL: 'not-a-url' }),
    /AGENT_DOWNLOAD_BASE_URL must be a valid absolute URL/,
  )
})
