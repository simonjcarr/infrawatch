import test from 'node:test'
import assert from 'node:assert/strict'

import { buildContentSecurityPolicy } from './csp.ts'

test('production CSP does not allow unsafe script execution', async () => {
  process.env.BETTER_AUTH_URL = 'https://ct-ops.example.com'

  const { default: nextConfig } = await import('../../next.config.ts')
  const headerGroups = await nextConfig.headers()
  const staticCspHeader = headerGroups
    .flatMap((group) => group.headers)
    .find((header) => header.key.toLowerCase() === 'content-security-policy')

  assert.equal(staticCspHeader, undefined)

  const directives = new Map(
    buildContentSecurityPolicy('test-nonce')
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .map(([name, ...values]) => [name, values]),
  )

  const scriptSrc = directives.get('script-src')

  assert.deepEqual(scriptSrc, ["'self'", "'nonce-test-nonce'", "'strict-dynamic'"])
  assert.ok(!scriptSrc.includes("'unsafe-eval'"))
  assert.ok(!scriptSrc.includes("'unsafe-inline'"))
})
