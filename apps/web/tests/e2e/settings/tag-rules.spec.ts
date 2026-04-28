import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG } from '../fixtures/seed'

async function getOrgId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ org_id: string }>>`
    SELECT id AS org_id
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.org_id
}

test('admin can run, disable, and delete a saved tag rule', async ({ authenticatedPage: page }) => {
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
        'tag-rule-host-match',
        ${orgId},
        'web-01',
        'Web 01',
        'Ubuntu 24.04',
        'x86_64',
        '["10.20.0.10"]'::jsonb,
        'online',
        NOW()
      ),
      (
        'tag-rule-host-ignore',
        ${orgId},
        'db-01',
        'DB 01',
        'Ubuntu 24.04',
        'x86_64',
        '["10.20.0.20"]'::jsonb,
        'offline',
        NOW()
      )
  `

  await sql`
    INSERT INTO tag_rules (
      id,
      organisation_id,
      name,
      filter,
      tags,
      enabled
    )
    VALUES (
      'tag-rule-e2e-1',
      ${orgId},
      'Production web hosts',
      '{"hostnameContains":"web","status":["online"]}'::jsonb,
      '[{"key":"env","value":"prod"}]'::jsonb,
      true
    )
  `

  await page.goto('/settings/tag-rules')

  await expect(page.getByTestId('tag-rules-heading')).toBeVisible()
  const ruleRow = page.getByTestId('tag-rule-row-tag-rule-e2e-1')
  await expect(ruleRow).toContainText('Production web hosts')
  await expect(ruleRow).toContainText('hostname contains "web"')
  await expect(ruleRow).toContainText('status=online')
  await expect(ruleRow).toContainText('env:prod')
  await expect(ruleRow).toContainText('Enabled')

  await page.getByTestId('tag-rule-run-tag-rule-e2e-1').click()
  await expect(page.getByTestId('tag-rules-message')).toContainText('Applied rule to 1 host(s).')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ key: string; value: string }>>`
        SELECT tags.key, tags.value
        FROM resource_tags
        JOIN tags ON tags.id = resource_tags.tag_id
        WHERE resource_tags.resource_type = 'host'
          AND resource_tags.resource_id = 'tag-rule-host-match'
        ORDER BY tags.key ASC, tags.value ASC
      `
      return rows
    })
    .toEqual([{ key: 'env', value: 'prod' }])

  const ignoredRows = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM resource_tags
    WHERE resource_type = 'host'
      AND resource_id = 'tag-rule-host-ignore'
  `
  expect(ignoredRows[0]?.count).toBe('0')

  await page.getByTestId('tag-rule-toggle-tag-rule-e2e-1').click()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ enabled: boolean }>>`
        SELECT enabled
        FROM tag_rules
        WHERE id = 'tag-rule-e2e-1'
        LIMIT 1
      `
      return rows[0]?.enabled ?? null
    })
    .toBe(false)

  await page.getByTestId('tag-rule-delete-tag-rule-e2e-1').click()
  await expect(ruleRow).toHaveCount(0)
  await expect(page.getByTestId('tag-rules-message')).toContainText('Rule deleted.')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM tag_rules
        WHERE id = 'tag-rule-e2e-1'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .toBeTruthy()
})
