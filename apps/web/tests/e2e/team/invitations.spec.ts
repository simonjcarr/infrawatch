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

async function setOrgSeatLimit(sql: ReturnType<typeof getTestDb>, orgId: string, maxUsers: number): Promise<void> {
  const licenceKey = await issueTestLicence({ orgId, tier: 'pro', maxUsers })
  await sql`
    UPDATE organisations
    SET licence_key = ${licenceKey},
        licence_tier = 'pro'
    WHERE id = ${orgId}
  `
}

async function clearOrgLicence(sql: ReturnType<typeof getTestDb>, orgId: string): Promise<void> {
  await sql`
    UPDATE organisations
    SET licence_key = NULL,
        licence_tier = 'community'
    WHERE id = ${orgId}
  `
}

test('admin can create and cancel a team invitation', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const inviteeEmail = 'teammate@example.com'

  await page.goto('/team')

  await expect(page.getByTestId('team-heading')).toBeVisible()
  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role-org_admin').click()
  await page.getByTestId('team-invite-role-read_only').click()
  await page.getByTestId('team-invite-submit').click()

  const inviteLink = page.getByTestId('team-invite-link')
  await expect(inviteLink).toBeVisible()
  await expect(inviteLink).toHaveValue(/\/register\?invite=/)
  await page.getByTestId('team-invite-done').click()

  const pendingInviteRow = page.getByTestId('team-pending-invite-row').filter({ hasText: inviteeEmail })
  await expect(pendingInviteRow).toBeVisible()
  await expect(pendingInviteRow).toContainText('Org Admin')
  await expect(pendingInviteRow).toContainText('Read Only')

  const inviteRows = await sql<Array<{ id: string; role: string; roles: string[]; deleted_at: Date | null }>>`
    SELECT id, role, roles, deleted_at
    FROM invitations
    WHERE organisation_id = ${orgId}
      AND email = ${inviteeEmail}
    ORDER BY created_at DESC
    LIMIT 1
  `

  expect(inviteRows).toHaveLength(1)
  expect(inviteRows[0]?.role).toBe('org_admin')
  expect(inviteRows[0]?.roles).toEqual(['org_admin', 'read_only'])
  expect(inviteRows[0]?.deleted_at).toBeNull()

  await pendingInviteRow.getByTestId('team-pending-invite-cancel').click()
  await expect(pendingInviteRow).toHaveCount(0)

  const cancelledInviteRows = await sql<Array<{ deleted_at: Date | null }>>`
    SELECT deleted_at
    FROM invitations
    WHERE id = ${inviteRows[0]!.id}
    LIMIT 1
  `

  expect(cancelledInviteRows).toHaveLength(1)
  expect(cancelledInviteRows[0]?.deleted_at).toBeTruthy()
})

test('admin cannot create a duplicate pending invitation for the same email address', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const inviteeEmail = 'duplicate-teammate@example.com'

  await page.goto('/team')

  await expect(page.getByTestId('team-heading')).toBeVisible()
  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role-engineer').click()
  await page.getByTestId('team-invite-submit').click()
  await expect(page.getByTestId('team-invite-link')).toBeVisible()
  await page.getByTestId('team-invite-done').click()

  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role-org_admin').click()
  await page.getByTestId('team-invite-submit').click()

  await expect(page.getByText('An invitation has already been sent to this email address')).toBeVisible()
  await expect(page.getByTestId('team-invite-link')).toHaveCount(0)

  const inviteRows = await sql<Array<{ role: string; roles: string[]; deleted_at: Date | null }>>`
    SELECT role, roles, deleted_at
    FROM invitations
    WHERE organisation_id = ${orgId}
      AND email = ${inviteeEmail}
    ORDER BY created_at ASC
  `

  expect(inviteRows).toHaveLength(1)
  expect(inviteRows[0]?.role).toBe('engineer')
  expect(inviteRows[0]?.roles).toEqual(['engineer'])
  expect(inviteRows[0]?.deleted_at).toBeNull()
})

test('admin cannot create an invitation when user seats are exhausted', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)

  try {
    await setOrgSeatLimit(sql, orgId, 1)

    await page.goto('/team')

    await expect(page.getByTestId('team-heading')).toBeVisible()
    await page.getByTestId('team-invite-open').click()
    await page.getByTestId('team-invite-email').fill('seat-limited-teammate@example.com')
    await page.getByTestId('team-invite-role-engineer').click()
    await page.getByTestId('team-invite-submit').click()

    await expect(page.getByText('User seat limit reached. This licence allows 1 user.')).toBeVisible()
    await expect(page.getByTestId('team-invite-link')).toHaveCount(0)

    const inviteRows = await sql<Array<{ id: string }>>`
      SELECT id
      FROM invitations
      WHERE organisation_id = ${orgId}
        AND email = 'seat-limited-teammate@example.com'
    `
    expect(inviteRows).toHaveLength(0)
  } finally {
    await clearOrgLicence(sql, orgId)
  }
})

test('admin re-inviting a removed user restores their membership instead of creating a pending invite', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const removedEmail = 'restored-member@example.com'

  await sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      organisation_id,
      role,
      roles,
      is_active,
      deleted_at
    )
    VALUES (
      'removed-team-member',
      'Restored Member',
      ${removedEmail},
      true,
      ${orgId},
      'read_only',
      '["read_only"]'::jsonb,
      false,
      NOW()
    )
  `

  await page.goto('/team')
  await expect(page.getByTestId('team-heading')).toBeVisible()

  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(removedEmail)
  await page.getByTestId('team-invite-role-engineer').click()
  await page.getByTestId('team-invite-role-read_only').click()
  await page.getByTestId('team-invite-submit').click()

  await expect(page.getByTestId('team-invite-link')).toHaveCount(0)
  await expect(page.getByTestId('team-member-row-removed-team-member')).toContainText('Restored Member')
  await expect(page.getByTestId('team-member-row-removed-team-member')).toContainText('Engineer')
  await expect(page.getByTestId('team-member-row-removed-team-member')).toContainText('Read Only')
  await expect(page.getByTestId('team-member-status-removed-team-member')).toContainText('Active')

  const restoredUserRows = await sql<Array<{ role: string; roles: string[]; is_active: boolean; deleted_at: Date | null }>>`
    SELECT role, roles, is_active, deleted_at
    FROM "user"
    WHERE email = ${removedEmail}
    LIMIT 1
  `

  expect(restoredUserRows).toEqual([
    {
      role: 'engineer',
      roles: ['engineer', 'read_only'],
      is_active: true,
      deleted_at: null,
    },
  ])

  const inviteRows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM invitations
    WHERE organisation_id = ${orgId}
      AND email = ${removedEmail}
  `

  expect(inviteRows).toHaveLength(0)
})
