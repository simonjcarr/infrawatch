import test from 'node:test'
import assert from 'node:assert/strict'

import { getBundleTransferDownloadOrigin } from './download-origin.ts'

function requestWithSpoofedOriginHeaders() {
  return {
    headers: new Headers({
      origin: 'https://evil.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'evil-forwarded.example',
      host: 'evil-host.example',
    }),
  }
}

test('getBundleTransferDownloadOrigin ignores spoofed request origin headers', () => {
  assert.equal(
    getBundleTransferDownloadOrigin(
      requestWithSpoofedOriginHeaders(),
      { BETTER_AUTH_URL: 'https://ct-ops.example.com/dashboard' },
    ),
    'https://ct-ops.example.com',
  )
})

test('getBundleTransferDownloadOrigin prefers configured agent download origin', () => {
  assert.equal(
    getBundleTransferDownloadOrigin(
      requestWithSpoofedOriginHeaders(),
      {
        AGENT_DOWNLOAD_BASE_URL: 'https://downloads.ct-ops.example.com/bundles/',
        BETTER_AUTH_URL: 'https://ct-ops.example.com',
      },
    ),
    'https://downloads.ct-ops.example.com',
  )
})
