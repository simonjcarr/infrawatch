import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_ORG, TEST_USER } from '../fixtures/seed'

async function getOrgAndUserIds(sql: ReturnType<typeof getTestDb>): Promise<{ orgId: string; userId: string }> {
  const rows = await sql<Array<{ org_id: string; user_id: string }>>`
    SELECT organisations.id AS org_id, "user".id AS user_id
    FROM organisations
    JOIN "user" ON "user".organisation_id = organisations.id
    WHERE organisations.slug = ${TEST_ORG.slug}
      AND "user".email = ${TEST_USER.email}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return {
    orgId: rows[0]!.org_id,
    userId: rows[0]!.user_id,
  }
}

test('admin can create and revoke an enrolment token from agent settings', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)

  await page.goto('/settings/agents')

  await expect(page.getByTestId('agent-enrolment-heading')).toBeVisible()
  await page.getByTestId('agent-enrolment-create-open').click()

  await page.getByTestId('agent-enrolment-label').fill('Datacenter Linux')
  await page.getByTestId('agent-enrolment-skip-verify').click()
  await page.getByTestId('agent-enrolment-max-uses').fill('3')
  await page.getByTestId('agent-enrolment-expires-days').fill('14')
  await page.getByTestId('agent-enrolment-create-submit').click()

  const installCommand = page.getByTestId('agent-enrolment-install-command')
  await expect(installCommand).toContainText('/api/agent/install?token=')
  await expect(installCommand).not.toContainText('skip_verify=true')

  await page.getByText('Show raw token (for manual config)').click()
  const rawToken = (await page.getByTestId('agent-enrolment-raw-token').textContent())?.trim()
  expect(rawToken).toBeTruthy()

  await expect
    .poll(async () => {
      const rows = await sql<Array<{
        id: string
        label: string
        created_by_id: string
        auto_approve: boolean
        skip_verify: boolean
        max_uses: number | null
        usage_count: number
        token: string
        token_hash: string | null
      }>>`
        SELECT
          id,
          label,
          created_by_id,
          auto_approve,
          skip_verify,
          max_uses,
          usage_count,
          token,
          token_hash
        FROM agent_enrolment_tokens
        WHERE organisation_id = ${orgId}
          AND label = 'Datacenter Linux'
        LIMIT 1
      `

      return rows[0] ?? null
    })
    .toMatchObject({
      label: 'Datacenter Linux',
      created_by_id: userId,
      auto_approve: false,
      skip_verify: false,
      max_uses: 3,
      usage_count: 0,
      token: rawToken,
    })

  await page.getByTestId('agent-enrolment-create-done').click()

  const tokenRow = page.getByTestId('agent-enrolment-row').filter({ hasText: 'Datacenter Linux' })
  await expect(tokenRow).toContainText('0 / 3')
  await expect(tokenRow).toContainText('Active')

  await tokenRow.getByTestId('agent-enrolment-revoke').click()
  await expect(tokenRow).toHaveCount(0)

  await expect
    .poll(async () => {
      const rows = await sql<Array<{ deleted_at: Date | null }>>`
        SELECT deleted_at
        FROM agent_enrolment_tokens
        WHERE organisation_id = ${orgId}
          AND label = 'Datacenter Linux'
        LIMIT 1
      `
      return rows[0]?.deleted_at ?? null
    })
    .toBeTruthy()
})

test('admin can create an auto-approved token that skips TLS verification', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId } = await getOrgAndUserIds(sql)

  await page.goto('/settings/agents')

  await expect(page.getByTestId('agent-enrolment-heading')).toBeVisible()
  await page.getByTestId('agent-enrolment-create-open').click()

  await page.getByTestId('agent-enrolment-label').fill('Remote Edge')
  await page.getByTestId('agent-enrolment-auto-approve').click()
  await page.getByTestId('agent-enrolment-max-uses').fill('2')
  await page.getByTestId('agent-enrolment-expires-days').fill('30')
  await page.getByTestId('agent-enrolment-create-submit').click()

  await expect(page.getByText('Only super_admin users may create auto-approve enrolment tokens.')).toBeVisible()

  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM agent_enrolment_tokens
    WHERE organisation_id = ${orgId}
      AND label = 'Remote Edge'
    LIMIT 1
  `

  expect(rows).toHaveLength(0)
})
