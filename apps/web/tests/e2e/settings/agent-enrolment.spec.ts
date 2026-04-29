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
  await expect(installCommand).toContainText('/api/agent/install')
  await expect(installCommand).not.toContainText('token=')
  await expect(installCommand).not.toContainText('skip_verify=true')

  await page.getByText('Show raw token (for manual config)').click()
  const rawToken = (await page.getByTestId('agent-enrolment-raw-token').textContent())?.trim()
  expect(rawToken).toBeTruthy()
  await expect(installCommand).not.toContainText(rawToken!)

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

test('admin can generate an install bundle with an existing token and bundle tags', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const { orgId, userId } = await getOrgAndUserIds(sql)
  let capturedBody: Record<string, unknown> | null = null

  await sql`
    INSERT INTO agent_enrolment_tokens (
      id,
      organisation_id,
      label,
      token,
      created_by_id,
      auto_approve,
      skip_verify,
      max_uses,
      usage_count,
      expires_at,
      metadata
    )
    VALUES (
      'bundle-existing-token-id',
      ${orgId},
      'Bundle Existing Token',
      'bundle-existing-token-value',
      ${userId},
      false,
      false,
      5,
      0,
      NOW() + INTERVAL '14 days',
      '{}'::jsonb
    )
  `

  await page.route('**/api/agent/bundle', async (route) => {
    capturedBody = route.request().postDataJSON() as Record<string, unknown>

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename=\"ct-ops-agent-linux-amd64.zip\"',
      },
      body: 'bundle-zip-placeholder',
    })
  })

  await page.goto('/settings/agents')

  await expect(page.getByTestId('agent-enrolment-heading')).toBeVisible()
  await page.getByRole('button', { name: 'Download Install Bundle' }).click()

  await page.getByLabel('Ingest address (optional)').fill('ingest.example.internal:7443')
  await page.getByLabel('Embed an existing token').click()
  await page.getByLabel('Active token').click()
  await page.getByRole('option', { name: 'Bundle Existing Token' }).click()
  await page.getByTestId('tag-editor-key').fill('env')
  await page.getByTestId('tag-editor-value').fill('prod')
  await page.getByTestId('tag-editor-add').click()
  const downloadButton = page.getByRole('dialog').getByRole('button', { name: 'Download' })
  await downloadButton.scrollIntoViewIfNeeded()
  await downloadButton.evaluate((button: HTMLButtonElement) => button.click())

  await expect
    .poll(() => capturedBody)
    .toMatchObject({
      os: 'linux',
      arch: 'amd64',
      ingestAddress: 'ingest.example.internal:7443',
      tokenId: 'bundle-existing-token-id',
      tags: [{ key: 'env', value: 'prod' }],
    })

  await expect(page.getByRole('dialog')).toHaveCount(0)
})
