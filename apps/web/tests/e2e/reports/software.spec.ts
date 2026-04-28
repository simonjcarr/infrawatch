import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'
import { issueTestLicence } from '../fixtures/licence'

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

test('software report supports search, saved filters, new packages, and drift views', async ({ authenticatedPage: page }) => {
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
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      os_version,
      arch,
      status
    )
    VALUES
      (
        'software-report-host-linux-1',
        ${orgId},
        'linux-app-01',
        'Linux App 01',
        'linux',
        'Ubuntu 24.04',
        'x86_64',
        'online'
      ),
      (
        'software-report-host-linux-2',
        ${orgId},
        'linux-app-02',
        'Linux App 02',
        'linux',
        'Ubuntu 24.04',
        'x86_64',
        'online'
      ),
      (
        'software-report-host-windows-1',
        ${orgId},
        'windows-edge-01',
        'Windows Edge 01',
        'windows',
        'Windows Server 2022',
        'x86_64',
        'online'
      )
  `

  await sql`
    INSERT INTO host_groups (
      id,
      organisation_id,
      name,
      description
    )
    VALUES (
      'software-report-group-1',
      ${orgId},
      'Production Estate',
      'Hosts used for software report E2E coverage.'
    )
  `

  await sql`
    INSERT INTO host_group_members (
      id,
      organisation_id,
      group_id,
      host_id
    )
    VALUES
      (
        'software-report-group-member-1',
        ${orgId},
        'software-report-group-1',
        'software-report-host-linux-1'
      ),
      (
        'software-report-group-member-2',
        ${orgId},
        'software-report-group-1',
        'software-report-host-linux-2'
      )
  `

  await sql`
    INSERT INTO software_packages (
      id,
      organisation_id,
      host_id,
      name,
      version,
      architecture,
      source,
      distro_id,
      distro_version_id,
      distro_codename,
      source_name,
      first_seen_at,
      last_seen_at
    )
    VALUES
      (
        'software-report-pkg-linux-1',
        ${orgId},
        'software-report-host-linux-1',
        'openssl',
        '3.0.2',
        'x86_64',
        'dpkg',
        'ubuntu',
        '24.04',
        'noble',
        'openssl',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '1 hour'
      ),
      (
        'software-report-pkg-linux-2',
        ${orgId},
        'software-report-host-linux-2',
        'openssl',
        '3.0.3',
        'x86_64',
        'dpkg',
        'ubuntu',
        '24.04',
        'noble',
        'openssl',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '30 minutes'
      ),
      (
        'software-report-pkg-windows-1',
        ${orgId},
        'software-report-host-windows-1',
        'openssl',
        '3.0.3',
        'x86_64',
        'winreg',
        'windows',
        '2022',
        'server',
        'openssl',
        NOW() - INTERVAL '12 hours',
        NOW() - INTERVAL '15 minutes'
      ),
      (
        'software-report-pkg-windows-2',
        ${orgId},
        'software-report-host-windows-1',
        'git',
        '2.45.1',
        'x86_64',
        'winreg',
        'windows',
        '2022',
        'server',
        'git',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '10 minutes'
      )
  `

  await page.goto('/reports/software')

  await expect(page.getByTestId('software-report-heading')).toBeVisible()
  await page.getByTestId('software-report-package-name').fill('open')
  await page.getByRole('option', { name: /openssl/i }).click()

  await expect(page.getByTestId('software-report-row-software-report-host-linux-1')).toContainText('Linux App 01')
  await expect(page.getByTestId('software-report-row-software-report-host-linux-2')).toContainText('Linux App 02')
  await expect(page.getByTestId('software-report-row-software-report-host-windows-1')).toContainText('Windows Edge 01')

  await page.getByTestId('software-report-os-filter').click()
  await page.getByRole('option', { name: 'Linux' }).click()

  await expect(page.getByTestId('software-report-row-software-report-host-linux-1')).toBeVisible()
  await expect(page.getByTestId('software-report-row-software-report-host-linux-2')).toBeVisible()
  await expect(page.getByTestId('software-report-row-software-report-host-windows-1')).toHaveCount(0)

  await page.getByTestId('software-report-save-filters-open').click()
  await page.getByTestId('software-report-save-name').fill('Linux OpenSSL')
  await page.getByTestId('software-report-save-submit').click()

  await page.getByTestId('software-report-os-filter').click()
  await page.getByRole('option', { name: 'All OS types' }).click()
  await expect(page.getByTestId('software-report-row-software-report-host-windows-1')).toBeVisible()

  await page.getByTestId('software-report-saved-reports-open').click()
  await expect(page.getByTestId('software-report-saved-report-load-0')).toContainText('Linux OpenSSL')
  await page.getByTestId('software-report-saved-report-load-0').click()

  await expect(page.getByTestId('software-report-row-software-report-host-linux-1')).toBeVisible()
  await expect(page.getByTestId('software-report-row-software-report-host-linux-2')).toBeVisible()
  await expect(page.getByTestId('software-report-row-software-report-host-windows-1')).toHaveCount(0)

  await page.getByTestId('software-report-saved-reports-open').click()
  await page.getByTestId('software-report-saved-report-delete-0').click()
  await expect(page.getByText('No saved reports yet.')).toBeVisible()
  await page.getByTestId('software-report-saved-reports-close').click()

  await page.getByTestId('software-report-tab-new-packages').click()
  await expect(page.getByTestId('software-report-new-package-openssl')).toContainText('3')
  await expect(page.getByTestId('software-report-new-package-git')).toContainText('1')

  await page.getByTestId('software-report-tab-drift').click()
  const driftRow = page.getByTestId('software-report-drift-row-0')
  await expect(driftRow).toContainText('openssl')
  await expect(driftRow).toContainText('Production Estate')
  await expect(driftRow).toContainText('3.0.2')
  await expect(driftRow).toContainText('3.0.3')
})
