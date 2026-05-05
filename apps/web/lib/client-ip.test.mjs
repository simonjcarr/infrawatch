import test from 'node:test'
import assert from 'node:assert/strict'

import { getClientIpFromHeaders } from './client-ip.ts'

function withEnv(value, fn) {
  const previous = process.env.CT_OPS_TRUST_PROXY_HEADERS
  if (value === undefined) {
    delete process.env.CT_OPS_TRUST_PROXY_HEADERS
  } else {
    process.env.CT_OPS_TRUST_PROXY_HEADERS = value
  }

  try {
    fn()
  } finally {
    if (previous === undefined) {
      delete process.env.CT_OPS_TRUST_PROXY_HEADERS
    } else {
      process.env.CT_OPS_TRUST_PROXY_HEADERS = previous
    }
  }
}

test('getClientIpFromHeaders ignores spoofable forwarding headers by default', () => {
  withEnv(undefined, () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.10, 198.51.100.7',
      'x-real-ip': '198.51.100.8',
    })

    assert.equal(getClientIpFromHeaders(headers), 'unknown')
  })
})

test('getClientIpFromHeaders uses forwarding headers when trusted proxy mode is enabled', () => {
  withEnv('true', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.10, 198.51.100.7',
      'x-real-ip': '198.51.100.8',
    })

    assert.equal(getClientIpFromHeaders(headers), '203.0.113.10')
  })
})

test('getClientIpFromHeaders falls back to x-real-ip in trusted proxy mode', () => {
  withEnv('1', () => {
    const headers = new Headers({
      'x-real-ip': '198.51.100.8',
    })

    assert.equal(getClientIpFromHeaders(headers), '198.51.100.8')
  })
})

test('getClientIpFromHeaders rejects invalid forwarded values', () => {
  withEnv('true', () => {
    const headers = new Headers({
      'x-forwarded-for': 'not an ip',
      'x-real-ip': 'also not an ip',
    })

    assert.equal(getClientIpFromHeaders(headers), 'unknown')
  })
})
