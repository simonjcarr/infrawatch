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

test('admin can change a team member role and manage their lifecycle', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const memberId = 'team-member-managed'

  await sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      organisation_id,
      role,
      roles,
      is_active
    )
    VALUES (
      ${memberId},
      'Managed Team Member',
      'managed-member@example.com',
      true,
      ${orgId},
      'engineer',
      '["engineer"]'::jsonb,
      true
    )
  `

  await page.goto('/team')

  const memberRow = page.getByTestId(`team-member-row-${memberId}`)
  await expect(page.getByTestId('team-heading')).toBeVisible()
  await expect(memberRow).toContainText('Managed Team Member')
  await expect(memberRow).toContainText('Engineer')
  await expect(page.getByTestId(`team-member-status-${memberId}`)).toContainText('Active')

  await page.getByTestId(`team-member-role-trigger-${memberId}`).click()
  await page.getByTestId(`team-member-role-option-${memberId}-read_only`).click()
  await expect(memberRow).toContainText('Read Only')
  await expect(memberRow).toContainText('Engineer')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ role: string; roles: string[] }>>`
        SELECT role, roles
        FROM "user"
        WHERE id = ${memberId}
        LIMIT 1
      `
      return rows[0]
        ? {
            role: rows[0].role,
            roles: rows[0].roles,
          }
        : null
    })
    .toEqual({
      role: 'engineer',
      roles: ['engineer', 'read_only'],
    })

  await page.getByTestId(`team-member-deactivate-${memberId}`).click()
  await expect(page.getByTestId(`team-member-status-${memberId}`)).toContainText('Inactive')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ is_active: boolean }>>`
        SELECT is_active
        FROM "user"
        WHERE id = ${memberId}
        LIMIT 1
      `
      return rows[0]?.is_active ?? null
    })
    .toBe(false)

  await page.getByTestId(`team-member-reactivate-${memberId}`).click()
  await expect(page.getByTestId(`team-member-status-${memberId}`)).toContainText('Active')

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ is_active: boolean }>>`
        SELECT is_active
        FROM "user"
        WHERE id = ${memberId}
        LIMIT 1
      `
      return rows[0]?.is_active ?? null
    })
    .toBe(true)

  await page.getByTestId(`team-member-deactivate-${memberId}`).click()
  await expect(page.getByTestId(`team-member-status-${memberId}`)).toContainText('Inactive')
  await page.getByTestId(`team-member-remove-${memberId}`).click()
  await expect(page.getByTestId(`team-member-row-${memberId}`)).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null; is_active: boolean }>>`
        SELECT deleted_at, is_active
        FROM "user"
        WHERE id = ${memberId}
        LIMIT 1
      `
      return rows[0]
        ? {
            deletedAt: Boolean(rows[0].deleted_at),
            isActive: rows[0].is_active,
          }
        : null
    })
    .toEqual({
      deletedAt: true,
      isActive: false,
    })
})
