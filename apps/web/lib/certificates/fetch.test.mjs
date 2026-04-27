import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseCertificateBuffer } from './fetch.ts'

function generateCertificatePem() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-ops-cert-'))
  try {
    const configPath = join(dir, 'openssl.cnf')
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    writeFileSync(configPath, `
[req]
distinguished_name = req_dn
x509_extensions = v3_req
prompt = no

[req_dn]
CN = example.com
O = Example Org
OU = Platform
C = GB
ST = London
L = London

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign, cRLSign
extendedKeyUsage = serverAuth, clientAuth
basicConstraints = critical, CA:true, pathlen:0
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
certificatePolicies = 1.2.3.4.5.6
authorityInfoAccess = OCSP;URI:http://ocsp.example.com,caIssuers;URI:http://ca.example.com/issuer.crt
crlDistributionPoints = URI:http://crl.example.com/root.crl

[alt_names]
DNS.1 = example.com
DNS.2 = www.example.com
IP.1 = 127.0.0.1
`, 'utf8')

    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '7',
      '-nodes',
      '-config', configPath,
      '-extensions', 'v3_req',
    ], { stdio: 'ignore' })

    return readFileSync(certPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('parseCertificateBuffer uses the X509 path and preserves key certificate metadata', () => {
  const pem = generateCertificatePem()
  const parsed = parseCertificateBuffer(pem)

  assert.equal(parsed.commonName, 'example.com')
  assert.equal(parsed.organization, 'Example Org')
  assert.equal(parsed.organizationalUnit, 'Platform')
  assert.equal(parsed.country, 'GB')
  assert.equal(parsed.state, 'London')
  assert.equal(parsed.locality, 'London')
  assert.equal(parsed.issuerCommonName, 'example.com')
  assert.equal(parsed.isSelfSigned, true)
  assert.equal(parsed.isCA, true)
  assert.equal(parsed.pathLength, 0)
  assert.equal(parsed.keyAlgorithm, 'RSA')
  assert.equal(parsed.keySize, 2048)
  assert.equal(parsed.signatureAlgorithm, 'SHA256withRSA')
  assert.deepEqual(parsed.keyUsage, [
    'Digital Signature',
    'Key Encipherment',
    'Certificate Sign',
    'CRL Sign',
  ])
  assert.deepEqual(parsed.extendedKeyUsage, [
    'TLS Web Server Authentication',
    'TLS Web Client Authentication',
  ])
  assert.deepEqual(parsed.sans, [
    { type: 'DNS', value: 'example.com' },
    { type: 'DNS', value: 'www.example.com' },
    { type: 'IP', value: '127.0.0.1' },
  ])
  assert.equal(parsed.certificatePolicies[0], '1.2.3.4.5.6')
  assert.equal(parsed.ocspUrls[0], 'http://ocsp.example.com')
  assert.equal(parsed.caIssuers[0], 'http://ca.example.com/issuer.crt')
  assert.equal(parsed.crlUrls[0], 'http://crl.example.com/root.crl')
  assert.match(parsed.subjectKeyId ?? '', /^([0-9A-F]{2}:)+[0-9A-F]{2}$/)
  assert.match(parsed.authorityKeyId ?? '', /^([0-9A-F]{2}:)+[0-9A-F]{2}$/)
  assert.equal(parsed.chain.length, 0)
  assert.match(parsed.fingerprintSha256, /^([0-9A-F]{2}:)+[0-9A-F]{2}$/)
  assert.match(parsed.fingerprintSha512, /^([0-9A-F]{2}:)+[0-9A-F]{2}$/)
})

test('parseCertificateBuffer rejects oversized PEM payloads before parsing', () => {
  const oversizedPem = Buffer.from(`-----BEGIN CERTIFICATE-----\n${'A'.repeat(70_000)}\n-----END CERTIFICATE-----`, 'utf8')
  assert.throws(
    () => parseCertificateBuffer(oversizedPem),
    /certificate PEM exceeds the 65536-byte size limit/,
  )
})
