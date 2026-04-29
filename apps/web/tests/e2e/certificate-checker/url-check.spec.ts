import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

const TRACKING_TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDZTCCAk2gAwIBAgIUGqljnkaJw0tIYv9uPQ+dGmImmaMwDQYJKoZIhvcNAQEL
BQAwQjEcMBoGA1UEAwwTdHJhY2tlci5leGFtcGxlLmNvbTEVMBMGA1UECgwMRXhh
bXBsZSBDb3JwMQswCQYDVQQGEwJHQjAeFw0yNjA0MjkwMDA4MTFaFw0yNzA0Mjkw
MDA4MTFaMEIxHDAaBgNVBAMME3RyYWNrZXIuZXhhbXBsZS5jb20xFTATBgNVBAoM
DEV4YW1wbGUgQ29ycDELMAkGA1UEBhMCR0IwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQCls/uua3AkgxheOFlZG4TpgyT6NWbDXedxyBQAJAfEZZI5+/g+
PWiBH2ZMMUXV79KPPYTXoXc7w63s6OWpysqD7b0jT1bv1JX3dTbYcW685yTE4exA
9OSnKUJTwxAPEZUrDfbGh8bzsjpPu6D1NMs59Qn/kd8TAbeZBbXbqj6dPXDxxnPY
8yHzRHwgmGoAm8ouE8es6DZhg27sD4ZSDxUz55tji/+4cDSsvaPsPhW+tfVMKr8j
3X/LViGPfOujd8fG78RPfFP/ETFTwRPd52vsEK/oTZOizThlhoVG3ZgZGyjnzrE9
59JqijoBDa/Kia7lqyDQGR3L+sAoXDhoRgMvAgMBAAGjUzBRMB0GA1UdDgQWBBTA
LVY9CMCJdYuFDBPdSLFM9oB8NjAfBgNVHSMEGDAWgBTALVY9CMCJdYuFDBPdSLFM
9oB8NjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBwb3aowTP+
z7AoqRDS1EHQYxHGdWkm3vFHJF0eoeGPcehlvI0Lag93l29GN183fSAY9Qs0ISTI
pw7les3KQwcHdf2k2aO5qEYaB5486dR1f9bA0BEDlbS35g0a14JmW7XHx59VvjbK
l17ftMPzQG2jbyffyQFluw1Ld/JcLCmioqUN9KKPEK1hYOj2ibBNCsVXnsHM3BKZ
AxPNuJ5L9aQj88sI0jQWcqiZLXT6JDV3IeV3S89LVi8nVAWp2mZDlVyEPBGVOP9H
z9EhcxayTDhI7Oo2n2yorFz7WHBpytSIN1vQTrhRAUPbNXAcOaUie5TserTteazP
sNone70z9cF/
-----END CERTIFICATE-----`

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('authenticated user can analyse a pasted certificate and clear the result', async ({ authenticatedPage: page }) => {
  let capturedBody: Record<string, unknown> | null = null

  await page.route('**/api/tools/certificate-checker', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    capturedBody = body

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        keyMatch: true,
        certificate: {
          pem: TRACKING_TEST_CERT_PEM,
          subject: 'CN=api.example.com, O=Example Corp, C=GB',
          issuer: 'CN=Example Issuing CA, O=Example PKI, C=GB',
          commonName: 'api.example.com',
          organization: 'Example Corp',
          organizationalUnit: 'Platform',
          country: 'GB',
          state: 'London',
          locality: 'London',
          issuerCommonName: 'Example Issuing CA',
          issuerOrganization: 'Example PKI',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z',
          daysRemaining: 200,
          isExpired: false,
          isExpiringSoon: false,
          isSelfSigned: false,
          isCA: false,
          pathLength: null,
          serialNumber: '01AB23CD45EF',
          fingerprintSha256: 'AA:BB:CC:DD',
          fingerprintSha512: '11:22:33:44',
          keyAlgorithm: 'RSA',
          keySize: 2048,
          curve: null,
          signatureAlgorithm: 'sha256WithRSAEncryption',
          subjectKeyId: 'subject-key-id',
          authorityKeyId: 'authority-key-id',
          keyUsage: ['Digital Signature', 'Key Encipherment'],
          extendedKeyUsage: ['TLS Web Server Authentication'],
          certificatePolicies: ['2.23.140.1.2.1'],
          sans: [
            { type: 'DNS', value: 'api.example.com' },
            { type: 'DNS', value: 'www.api.example.com' },
          ],
          ocspUrls: ['http://ocsp.example.com'],
          caIssuers: ['http://crt.example.com/issuer.crt'],
          crlUrls: ['http://crl.example.com/root.crl'],
          chain: [
            {
              subject: 'CN=api.example.com, O=Example Corp, C=GB',
              issuer: 'CN=Example Issuing CA, O=Example PKI, C=GB',
              notAfter: '2027-01-01T00:00:00.000Z',
              isCA: false,
              fingerprintSha256: 'AA:BB:CC:DD',
            },
            {
              subject: 'CN=Example Issuing CA, O=Example PKI, C=GB',
              issuer: 'CN=Example Root CA, O=Example PKI, C=GB',
              notAfter: '2028-01-01T00:00:00.000Z',
              isCA: true,
              fingerprintSha256: 'EE:FF:GG:HH',
            },
          ],
        },
      }),
    })
  })

  await page.goto('/certificate-checker')

  await expect(page.getByTestId('certificate-checker-heading')).toBeVisible()

  await page.locator('#cert-input').fill(
    '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
  )
  await page.locator('#key-input').fill(
    'matching-key-placeholder',
  )
  await page.getByRole('button', { name: 'Analyse Certificate' }).click()

  await expect
    .poll(() => capturedBody)
    .toMatchObject({
      action: 'parse',
      pemText: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      keyPem: 'matching-key-placeholder',
    })

  await expect(page.getByTestId('certificate-checker-result')).toBeVisible()
  await expect(page.getByTestId('certificate-checker-result-title')).toContainText('api.example.com')
  await expect(page.getByTestId('certificate-checker-status')).toContainText('Valid')
  await expect(page.getByTestId('certificate-checker-key-match')).toContainText(
    'Private key matches this certificate',
  )
  await expect(page.getByTestId('certificate-checker-san-count')).toContainText('2')

  await page.getByTestId('certificate-checker-clear').click()
  await expect(page.getByTestId('certificate-checker-result')).toHaveCount(0)
  await expect(page.getByTestId('certificate-checker-empty-state')).toBeVisible()
})

test('authenticated user can analyse an uploaded certificate file with a matching key', async ({ authenticatedPage: page }) => {
  let capturedBody: Record<string, unknown> | null = null

  await page.route('**/api/tools/certificate-checker', async (route) => {
    capturedBody = route.request().postDataJSON() as Record<string, unknown>

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        keyMatch: true,
        certificate: {
          pem: TRACKING_TEST_CERT_PEM,
          subject: 'CN=upload.example.com, O=Example Corp, C=GB',
          issuer: 'CN=Example Issuing CA, O=Example PKI, C=GB',
          commonName: 'upload.example.com',
          organization: 'Example Corp',
          organizationalUnit: 'Platform',
          country: 'GB',
          state: 'London',
          locality: 'London',
          issuerCommonName: 'Example Issuing CA',
          issuerOrganization: 'Example PKI',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z',
          daysRemaining: 200,
          isExpired: false,
          isExpiringSoon: false,
          isSelfSigned: false,
          isCA: false,
          pathLength: null,
          serialNumber: 'UPLOAD12345',
          fingerprintSha256: 'UPLOAD:AA:BB:CC:DD',
          fingerprintSha512: 'UPLOAD:11:22:33:44',
          keyAlgorithm: 'RSA',
          keySize: 2048,
          curve: null,
          signatureAlgorithm: 'sha256WithRSAEncryption',
          subjectKeyId: 'upload-subject-key-id',
          authorityKeyId: 'upload-authority-key-id',
          keyUsage: ['Digital Signature', 'Key Encipherment'],
          extendedKeyUsage: ['TLS Web Server Authentication'],
          certificatePolicies: ['2.23.140.1.2.1'],
          sans: [
            { type: 'DNS', value: 'upload.example.com' },
          ],
          ocspUrls: [],
          caIssuers: [],
          crlUrls: [],
          chain: [
            {
              subject: 'CN=upload.example.com, O=Example Corp, C=GB',
              issuer: 'CN=Example Issuing CA, O=Example PKI, C=GB',
              notBefore: '2026-01-01T00:00:00.000Z',
              notAfter: '2027-01-01T00:00:00.000Z',
              isCA: false,
              fingerprintSha256: 'UPLOAD:AA:BB:CC:DD',
            },
          ],
        },
      }),
    })
  })

  const tmpDir = path.join(process.cwd(), 'tests', 'e2e', '.tmp')
  const certPath = path.join(tmpDir, 'certificate-checker-upload.der')
  const keyPath = path.join(tmpDir, 'certificate-checker-upload.key')
  const certBytes = Buffer.from([0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01, 0x00, 0xd9, 0xaa, 0x55])
  const keyPem = [
    '-----BEGIN PRIVATE KEY-----',
    'uploaded-test-key',
    '-----END PRIVATE KEY-----',
  ].join('\n')

  await mkdir(tmpDir, { recursive: true })
  await writeFile(certPath, certBytes)
  await writeFile(keyPath, keyPem)

  await page.goto('/certificate-checker')

  await expect(page.getByTestId('certificate-checker-heading')).toBeVisible()
  await page.locator('input[type="file"]').nth(0).setInputFiles(certPath)
  await page.locator('input[type="file"]').nth(1).setInputFiles(keyPath)
  await page.getByRole('button', { name: 'Analyse Certificate' }).click()

  await expect
    .poll(() => capturedBody)
    .toMatchObject({
      action: 'parse',
      data: certBytes.toString('base64'),
      keyPem,
    })

  await expect(page.getByTestId('certificate-checker-result')).toBeVisible()
  await expect(page.getByTestId('certificate-checker-result-title')).toContainText('upload.example.com')
  await expect(page.getByTestId('certificate-checker-status')).toContainText('Valid')
  await expect(page.getByTestId('certificate-checker-key-match')).toContainText(
    'Private key matches this certificate',
  )
})

test('authenticated user can track an uploaded certificate after analysis', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  await page.route('**/api/tools/certificate-checker', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        keyMatch: true,
        certificate: {
          pem: TRACKING_TEST_CERT_PEM,
          subject: 'CN=tracker.example.com, O=Example Corp, C=GB',
          issuer: 'CN=Example Issuing CA, O=Example PKI, C=GB',
          commonName: 'tracker.example.com',
          organization: 'Example Corp',
          organizationalUnit: 'Platform',
          country: 'GB',
          state: 'London',
          locality: 'London',
          issuerCommonName: 'Example Issuing CA',
          issuerOrganization: 'Example PKI',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z',
          daysRemaining: 200,
          isExpired: false,
          isExpiringSoon: false,
          isSelfSigned: false,
          isCA: false,
          pathLength: null,
          serialNumber: 'TRACKER12345',
          fingerprintSha256: 'TRACKER:AA:BB:CC:DD',
          fingerprintSha512: 'TRACKER:11:22:33:44',
          keyAlgorithm: 'RSA',
          keySize: 2048,
          curve: null,
          signatureAlgorithm: 'sha256WithRSAEncryption',
          subjectKeyId: 'tracker-subject-key-id',
          authorityKeyId: 'tracker-authority-key-id',
          keyUsage: ['Digital Signature', 'Key Encipherment'],
          extendedKeyUsage: ['TLS Web Server Authentication'],
          certificatePolicies: ['2.23.140.1.2.1'],
          sans: [
            { type: 'DNS', value: 'tracker.example.com' },
          ],
          ocspUrls: [],
          caIssuers: [],
          crlUrls: [],
          chain: [
            {
              subject: 'CN=tracker.example.com, O=Example Corp, C=GB',
              issuer: 'CN=Example Issuing CA, O=Example PKI, C=GB',
              notBefore: '2026-01-01T00:00:00.000Z',
              notAfter: '2027-01-01T00:00:00.000Z',
              isCA: false,
              fingerprintSha256: 'TRACKER:AA:BB:CC:DD',
            },
          ],
        },
      }),
    })
  })

  await page.goto('/certificate-checker')

  await page.locator('#cert-input').fill(TRACKING_TEST_CERT_PEM)
  await page.getByRole('button', { name: 'Analyse Certificate' }).click()

  await expect(page.getByTestId('certificate-checker-result')).toBeVisible()
  await page.getByRole('button', { name: 'Track this certificate' }).click()

  await expect(page.getByText('Added to tracker')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View in Certificate Tracker' })).toBeVisible()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        host: string
        port: number
        server_name: string
        common_name: string | null
        tracked_url: string | null
      }>>`
        SELECT host, port, server_name, common_name, tracked_url
        FROM certificates
        WHERE organisation_id = ${orgId}
          AND host = 'tracker.example.com'
          AND deleted_at IS NULL
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toEqual({
      host: 'tracker.example.com',
      port: 0,
      server_name: 'tracker.example.com',
      common_name: 'tracker.example.com',
      tracked_url: null,
    })
})
