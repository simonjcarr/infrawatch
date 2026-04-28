import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug} LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('admin can monitor vulnerability API sources and pulled CVEs', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  await getOrgId(sql)

  await sql`
    INSERT INTO vulnerability_sources (
      id, status, last_attempt_at, last_success_at, records_upserted, metadata
    )
    VALUES
      ('nvd', 'success', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes', 42, '{"lastModStartDate":"2026-04-27T00:00:00.000Z","lastModEndDate":"2026-04-28T00:00:00.000Z"}'::jsonb),
      ('cisa-kev', 'error', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '1 day', 12, '{"sha256":"feed-hash"}'::jsonb)
  `

  await sql`
    INSERT INTO vulnerability_cves (
      cve_id, title, description, severity, cvss_score, published_at, modified_at,
      known_exploited, source
    )
    VALUES
      ('CVE-2026-1001', 'OpenSSL bounds check issue', 'A test CVE from NVD', 'critical', 9.8, NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 minutes', false, 'nvd'),
      ('CVE-2026-1002', 'Known exploited test issue', 'A test CVE from CISA KEV', 'high', 8.7, NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', true, 'cisa-kev')
  `

  await page.goto('/settings/vulnerabilities')

  await expect(page.getByRole('heading', { name: 'Vulnerability Management' })).toBeVisible()
  await expect(page.getByText('API Connections')).toBeVisible()
  await expect(page.getByText('Every 6h')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'NVD CVE API nvd' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'CISA KEV Catalog cisa-kev' })).toBeVisible()
  await expect(page.getByText('https://services.nvd.nist.gov/rest/json/cves/2.0')).toBeVisible()
  await expect(page.getByText('https://security-tracker.debian.org/tracker/data/json')).toBeVisible()
  await expect(page.getByText('Connected').first()).toBeVisible()
  await expect(page.getByText('Error').first()).toBeVisible()
  await expect(page.getByText('Not attempted').first()).toBeVisible()
  await expect(page.getByRole('cell', { name: '42' })).toBeVisible()

  await expect(page.getByText('CVE Catalog')).toBeVisible()
  await expect(page.getByText('CVE-2026-1001')).toBeVisible()
  await expect(page.getByText('OpenSSL bounds check issue')).toBeVisible()
  await expect(page.getByText('CVE-2026-1002')).toBeVisible()

  await page.getByLabel('CVE or title').fill('1002')
  await expect(page.getByText('CVE-2026-1001')).toBeHidden()
  await expect(page.getByText('CVE-2026-1002')).toBeVisible()
})
