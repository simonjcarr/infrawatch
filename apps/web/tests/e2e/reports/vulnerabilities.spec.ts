import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'
import { issueTestLicence } from '../fixtures/licence'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug} LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

test('vulnerability report filters open findings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const licenceKey = await issueTestLicence({ orgId, tier: 'pro' })

  await sql`
    UPDATE organisations
    SET licence_key = ${licenceKey},
        licence_tier = 'pro'
    WHERE id = ${orgId}
  `

  await sql`
    INSERT INTO hosts (id, organisation_id, hostname, display_name, os, arch, status)
    VALUES ('report-vuln-host-1', ${orgId}, 'report-vuln-node-1', 'Report Vuln Node', 'linux', 'x86_64', 'online')
  `
  await sql`
    INSERT INTO software_packages (
      id, organisation_id, host_id, name, version, source,
      distro_id, distro_version_id, distro_codename, source_name,
      first_seen_at, last_seen_at
    )
    VALUES (
      'report-vuln-pkg-1', ${orgId}, 'report-vuln-host-1', 'openssl', '3.0.2-0ubuntu1.15', 'dpkg',
      'ubuntu', '22.04', 'jammy', 'openssl',
      NOW(), NOW()
    )
  `
  await sql`
    INSERT INTO vulnerability_cves (cve_id, description, severity, known_exploited)
    VALUES ('CVE-2024-4321', 'Report vulnerability', 'high', false)
  `
  await sql`
    INSERT INTO host_vulnerability_findings (
      id, organisation_id, host_id, software_package_id, cve_id, status,
      package_name, installed_version, fixed_version, source, severity,
      first_seen_at, last_seen_at
    )
    VALUES (
      'report-finding-1', ${orgId}, 'report-vuln-host-1', 'report-vuln-pkg-1', 'CVE-2024-4321', 'open',
      'openssl', '3.0.2-0ubuntu1.15', '3.0.2-0ubuntu1.16', 'dpkg', 'high',
      NOW(), NOW()
    )
  `

  await page.goto('/reports/vulnerabilities')
  await expect(page.getByText('CVE-2024-4321')).toBeVisible()
  await expect(page.getByText('Report Vuln Node')).toBeVisible()

  await page.getByLabel('Package').fill('does-not-match')
  await expect(page.getByText('CVE-2024-4321')).toBeHidden()
})
