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

test('admin can preview, apply, and save bulk host tags', async ({ authenticatedPage: page }) => {
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
      ip_addresses,
      status,
      last_seen_at
    )
    VALUES
      (
        'bulk-tag-host-match',
        ${orgId},
        'web-01',
        'Web 01',
        'Ubuntu 24.04',
        'x86_64',
        '["10.30.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'bulk-tag-host-ignore',
        ${orgId},
        'db-01',
        'DB 01',
        'Ubuntu 24.04',
        'x86_64',
        '["10.30.0.20"]'::jsonb,
        'offline',
        NOW()
      )
  `

  await page.goto('/hosts/bulk-tag')

  await expect(page.getByTestId('bulk-tag-heading')).toBeVisible()

  await page.getByTestId('bulk-tag-filter-hostname-contains').fill('web')
  await page.getByTestId('bulk-tag-filter-status').fill('online')
  await page.getByTestId('tag-editor-key').fill('env')
  await page.getByTestId('tag-editor-value').fill('prod')
  await page.getByTestId('tag-editor-add').click()

  await page.getByTestId('bulk-tag-preview').click()

  await expect(page.getByTestId('bulk-tag-preview-heading')).toContainText('Matching hosts (1)')
  await expect(page.getByTestId('bulk-tag-preview-row-bulk-tag-host-match')).toContainText('Web 01')
  await expect(page.getByTestId('bulk-tag-preview-row-bulk-tag-host-ignore')).toHaveCount(0)

  await page.getByTestId('bulk-tag-apply').click()
  await expect(page.getByTestId('bulk-tag-message')).toContainText('Applied tags to 1 host(s).')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ key: string; value: string }>>`
        SELECT tags.key, tags.value
        FROM resource_tags
        JOIN tags ON tags.id = resource_tags.tag_id
        WHERE resource_tags.resource_type = 'host'
          AND resource_tags.resource_id = 'bulk-tag-host-match'
        ORDER BY tags.key ASC, tags.value ASC
      `
      return rows
    })
    .toEqual([{ key: 'env', value: 'prod' }])

  const ignoredRows = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM resource_tags
    WHERE resource_type = 'host'
      AND resource_id = 'bulk-tag-host-ignore'
  `
  expect(ignoredRows[0]?.count).toBe('0')

  await page.getByTestId('bulk-tag-save-open').click()
  await page.getByTestId('bulk-tag-rule-name').fill('Production web hosts')
  await page.getByTestId('bulk-tag-rule-save').click()

  await expect(page.getByTestId('bulk-tag-message')).toContainText(
    'Rule saved — it will auto-apply to matching hosts on approval.',
  )

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        name: string
        filter: { hostnameContains?: string; status?: string[] } | null
        tags: Array<{ key: string; value: string }> | null
      }>>`
        SELECT name, filter, tags
        FROM tag_rules
        WHERE organisation_id = ${orgId}
          AND deleted_at IS NULL
          AND name = 'Production web hosts'
        LIMIT 1
      `
      return rows[0] ?? null
    })
    .toMatchObject({
      name: 'Production web hosts',
      filter: {
        hostnameContains: 'web',
        status: ['online'],
      },
      tags: [{ key: 'env', value: 'prod' }],
    })
})
