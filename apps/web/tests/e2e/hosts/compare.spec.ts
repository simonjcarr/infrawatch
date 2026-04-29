import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
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

test('authenticated user can compare packages between two hosts', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      arch,
      status
    )
    VALUES
      (
        'compare-host-a',
        ${orgId},
        'compare-host-a',
        'Compare Host A',
        'Ubuntu 24.04',
        'x86_64',
        'online'
      ),
      (
        'compare-host-b',
        ${orgId},
        'compare-host-b',
        'Compare Host B',
        'Ubuntu 24.04',
        'x86_64',
        'online'
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
      first_seen_at,
      last_seen_at
    )
    VALUES
      (
        'compare-pkg-openssl-a',
        ${orgId},
        'compare-host-a',
        'openssl',
        '3.0.2',
        'x86_64',
        'dpkg',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '1 hour'
      ),
      (
        'compare-pkg-nginx-a',
        ${orgId},
        'compare-host-a',
        'nginx',
        '1.24.0',
        'x86_64',
        'dpkg',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '1 hour'
      ),
      (
        'compare-pkg-openssl-b',
        ${orgId},
        'compare-host-b',
        'openssl',
        '3.0.3',
        'x86_64',
        'dpkg',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '30 minutes'
      ),
      (
        'compare-pkg-curl-b',
        ${orgId},
        'compare-host-b',
        'curl',
        '8.7.1',
        'x86_64',
        'dpkg',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '30 minutes'
      )
  `

  await page.goto('/hosts/compare-host-a/compare?with=compare-host-b')

  await expect(page.getByTestId('host-compare-heading')).toBeVisible()
  await expect(page.getByTestId('host-compare-different-versions')).toContainText('Different versions')
  await expect(page.getByTestId('host-compare-different-row-openssl')).toContainText('3.0.2')
  await expect(page.getByTestId('host-compare-different-row-openssl')).toContainText('3.0.3')

  await expect(page.getByTestId('host-compare-only-in-a')).toContainText('Only in host A')
  await expect(page.getByTestId('host-compare-only-in-a-row-nginx')).toContainText('1.24.0')

  await expect(page.getByTestId('host-compare-only-in-b')).toContainText('Only in host B')
  await expect(page.getByTestId('host-compare-only-in-b-row-curl')).toContainText('8.7.1')
})

test('authenticated user sees an empty-state message when no comparison host is supplied', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  await sql`
    INSERT INTO hosts (
      id,
      organisation_id,
      hostname,
      display_name,
      os,
      arch,
      status
    )
    VALUES (
      'compare-host-empty',
      ${orgId},
      'compare-host-empty',
      'Compare Host Empty',
      'Ubuntu 24.04',
      'x86_64',
      'online'
    )
  `

  await page.goto('/hosts/compare-host-empty/compare')

  await expect(page.getByTestId('host-compare-empty-state')).toContainText(
    'No host to compare with.',
  )
  await expect(page.getByRole('link', { name: 'Back to host' })).toHaveAttribute(
    'href',
    '/hosts/compare-host-empty',
  )
})
