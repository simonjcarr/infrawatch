import test from 'node:test'
import assert from 'node:assert/strict'

import { getTlsOptions } from './tls-options.ts'

test('getTlsOptions keeps certificate verification enabled when no custom CA is configured', () => {
  const tlsOptions = getTlsOptions({
    useTls: true,
    useStartTls: false,
    tlsCertificate: null,
  })

  assert.deepEqual(tlsOptions, {})
  assert.equal(tlsOptions?.rejectUnauthorized, undefined)
})

test('getTlsOptions includes a CA bundle without disabling verification', () => {
  const tlsOptions = getTlsOptions({
    useTls: true,
    useStartTls: false,
    tlsCertificate: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  })

  assert.deepEqual(tlsOptions, {
    ca: ['-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'],
    rejectUnauthorized: true,
  })
})
