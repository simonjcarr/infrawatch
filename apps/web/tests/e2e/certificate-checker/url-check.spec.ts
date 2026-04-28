import { test, expect } from '../fixtures/test'

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
          pem: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
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
