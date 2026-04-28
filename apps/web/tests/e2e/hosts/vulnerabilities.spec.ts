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

test('host inventory tab shows Linux package CVE findings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  await sql`
    INSERT INTO hosts (id, organisation_id, hostname, display_name, os, arch, ip_addresses, status, last_seen_at)
    VALUES ('vuln-host-1', ${orgId}, 'vuln-node-1', 'Vuln Node 1', 'linux', 'x86_64', '["10.30.0.10"]'::jsonb, 'online', NOW())
  `
  await sql`
    INSERT INTO software_packages (
      id, organisation_id, host_id, name, version, architecture, source,
      distro_id, distro_version_id, distro_codename, source_name, source_version,
      first_seen_at, last_seen_at
    )
    VALUES (
      'vuln-pkg-1', ${orgId}, 'vuln-host-1', 'libssl3', '3.0.2-0ubuntu1.15', 'amd64', 'dpkg',
      'ubuntu', '22.04', 'jammy', 'openssl', '3.0.2-0ubuntu1.15',
      NOW(), NOW()
    )
  `
  await sql`
    INSERT INTO vulnerability_cves (cve_id, description, severity, known_exploited)
    VALUES ('CVE-2024-1234', 'OpenSSL test vulnerability', 'critical', true)
  `
  await sql`
    INSERT INTO vulnerability_affected_packages (
      id, cve_id, source, distro_id, distro_version_id, distro_codename,
      package_name, fixed_version, severity
    )
    VALUES (
      'affected-1', 'CVE-2024-1234', 'ubuntu-osv', 'ubuntu', '22.04', 'jammy',
      'openssl', '3.0.2-0ubuntu1.16', 'critical'
    )
  `
  await sql`
    INSERT INTO host_vulnerability_findings (
      id, organisation_id, host_id, software_package_id, cve_id, affected_package_id,
      status, package_name, installed_version, fixed_version, source, severity,
      known_exploited, first_seen_at, last_seen_at
    )
    VALUES (
      'finding-1', ${orgId}, 'vuln-host-1', 'vuln-pkg-1', 'CVE-2024-1234', 'affected-1',
      'open', 'libssl3', '3.0.2-0ubuntu1.15', '3.0.2-0ubuntu1.16', 'dpkg', 'critical',
      true, NOW(), NOW()
    )
  `

  await page.goto('/hosts/vuln-host-1')
  await page.getByRole('button', { name: 'Inventory' }).click()
  await page.getByRole('button', { name: 'Vulnerabilities' }).click()

  await expect(page.getByText('CVE-2024-1234')).toBeVisible()
  await expect(page.getByText('libssl3')).toBeVisible()
  await expect(page.getByText('3.0.2-0ubuntu1.16')).toBeVisible()
})

