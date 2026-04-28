import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertAllowedCertificateCheckerTarget,
  assertAllowedCertificateCheckerPort,
  getAllowedCertificateCheckerPorts,
} from './certificate-checker-policy.ts'

test('allows the documented certificate-checker ports', () => {
  for (const port of getAllowedCertificateCheckerPorts()) {
    assert.doesNotThrow(() => assertAllowedCertificateCheckerPort(port))
  }
})

test('rejects non-TLS and internal-service ports', () => {
  for (const port of [22, 80, 5432, 2375, 3306]) {
    assert.throws(
      () => assertAllowedCertificateCheckerPort(port),
      /Blocked: port .* is not allowed/,
    )
  }
})

test('allows certificate checks against private network hosts on allowed TLS ports', () => {
  for (const host of ['192.168.8.215', '10.0.0.12', 'ct-ops.carrtech.laptop']) {
    assert.doesNotThrow(() => assertAllowedCertificateCheckerTarget(host, 443))
  }
})
