import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { issueTestLicence } from '../fixtures/licence'
import { TEST_ORG } from '../fixtures/seed'

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

test('admin can review, filter, and delete tracked certificates', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const licenceKey = await issueTestLicence({
    orgId,
    features: ['certExpiryTracker'],
  })

  await sql`
    UPDATE organisations
    SET licence_key = ${licenceKey},
        licence_tier = 'pro'
    WHERE id = ${orgId}
  `

  await sql`
    INSERT INTO certificates (
      id,
      organisation_id,
      source,
      host,
      port,
      server_name,
      common_name,
      issuer,
      sans,
      not_before,
      not_after,
      fingerprint_sha256,
      status,
      details,
      last_seen_at
    )
    VALUES
      (
        'cert-e2e-valid',
        ${orgId},
        'discovered',
        'api.example.com',
        443,
        'api.example.com',
        'api.example.com',
        'CT Test CA',
        '["api.example.com"]'::jsonb,
        NOW() - INTERVAL '10 days',
        NOW() + INTERVAL '45 days',
        'sha256-valid',
        'valid',
        '{"subject":"CN=api.example.com","issuer":"CN=CT Test CA","serialNumber":"1001","signatureAlgorithm":"sha256WithRSAEncryption","keyAlgorithm":"RSA-2048","isSelfSigned":false,"chain":[]}'::jsonb,
        NOW() - INTERVAL '5 minutes'
      ),
      (
        'cert-e2e-expiring',
        ${orgId},
        'discovered',
        'edge.example.com',
        8443,
        'edge.example.com',
        'edge.example.com',
        'CT Test CA',
        '["edge.example.com"]'::jsonb,
        NOW() - INTERVAL '20 days',
        NOW() + INTERVAL '3 days',
        'sha256-expiring',
        'expiring_soon',
        '{"subject":"CN=edge.example.com","issuer":"CN=CT Test CA","serialNumber":"1002","signatureAlgorithm":"sha256WithRSAEncryption","keyAlgorithm":"RSA-2048","isSelfSigned":false,"chain":[]}'::jsonb,
        NOW() - INTERVAL '10 minutes'
      ),
      (
        'cert-e2e-expired',
        ${orgId},
        'discovered',
        'legacy.example.com',
        443,
        'legacy.example.com',
        'legacy.example.com',
        'Legacy CA',
        '["legacy.example.com"]'::jsonb,
        NOW() - INTERVAL '90 days',
        NOW() - INTERVAL '1 day',
        'sha256-expired',
        'expired',
        '{"subject":"CN=legacy.example.com","issuer":"CN=Legacy CA","serialNumber":"1003","signatureAlgorithm":"sha256WithRSAEncryption","keyAlgorithm":"RSA-2048","isSelfSigned":false,"chain":[]}'::jsonb,
        NOW() - INTERVAL '30 minutes'
      )
  `

  await page.goto('/certificates')

  await expect(page.getByTestId('certificates-heading')).toBeVisible()
  await expect(page.getByTestId('certificate-row-cert-e2e-valid')).toContainText('api.example.com')
  await expect(page.getByTestId('certificate-row-cert-e2e-expiring')).toContainText('edge.example.com')
  await expect(page.getByTestId('certificate-row-cert-e2e-expired')).toContainText('legacy.example.com')

  await page.getByTestId('certificates-filter-host').fill('edge')
  await expect(page.getByTestId('certificate-row-cert-e2e-expiring')).toBeVisible()
  await expect(page.getByTestId('certificate-row-cert-e2e-valid')).toHaveCount(0)
  await expect(page.getByTestId('certificate-row-cert-e2e-expired')).toHaveCount(0)

  await page.getByTestId('certificates-filter-host').fill('')
  await page.getByTestId('certificates-status-filter').click()
  await page.getByRole('option', { name: 'Expired' }).click()

  await expect(page.getByTestId('certificate-row-cert-e2e-expired')).toBeVisible()
  await expect(page.getByTestId('certificate-row-cert-e2e-valid')).toHaveCount(0)
  await expect(page.getByTestId('certificate-row-cert-e2e-expiring')).toHaveCount(0)

  await page.getByTestId('certificate-delete-cert-e2e-expired').click()
  await expect(page.getByTestId('certificate-row-cert-e2e-expired')).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM certificates
        WHERE id = 'cert-e2e-expired'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .toBeTruthy()
})
