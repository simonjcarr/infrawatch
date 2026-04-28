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

test('admin can create and cancel a team invitation', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const inviteeEmail = 'teammate@example.com'

  await page.goto('/team')

  await expect(page.getByTestId('team-heading')).toBeVisible()
  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role').selectOption('read_only')
  await page.getByTestId('team-invite-submit').click()

  const inviteLink = page.getByTestId('team-invite-link')
  await expect(inviteLink).toBeVisible()
  await expect(inviteLink).toHaveValue(/\/register\?invite=/)
  await page.getByTestId('team-invite-done').click()

  const pendingInviteRow = page.getByTestId('team-pending-invite-row').filter({ hasText: inviteeEmail })
  await expect(pendingInviteRow).toBeVisible()
  await expect(pendingInviteRow).toContainText('Read Only')

  const inviteRows = await sql<Array<{ id: string; role: string; deleted_at: Date | null }>>`
    SELECT id, role, deleted_at
    FROM invitations
    WHERE organisation_id = ${orgId}
      AND email = ${inviteeEmail}
    ORDER BY created_at DESC
    LIMIT 1
  `

  expect(inviteRows).toHaveLength(1)
  expect(inviteRows[0]?.role).toBe('read_only')
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
  await page.getByTestId('team-invite-role').selectOption('engineer')
  await page.getByTestId('team-invite-submit').click()
  await expect(page.getByTestId('team-invite-link')).toBeVisible()
  await page.getByTestId('team-invite-done').click()

  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role').selectOption('org_admin')
  await page.getByTestId('team-invite-submit').click()

  await expect(page.getByText('An invitation has already been sent to this email address')).toBeVisible()
  await expect(page.getByTestId('team-invite-link')).toHaveCount(0)

  const inviteRows = await sql<Array<{ role: string; deleted_at: Date | null }>>`
    SELECT role, deleted_at
    FROM invitations
    WHERE organisation_id = ${orgId}
      AND email = ${inviteeEmail}
    ORDER BY created_at ASC
  `

  expect(inviteRows).toHaveLength(1)
  expect(inviteRows[0]?.role).toBe('engineer')
  expect(inviteRows[0]?.deleted_at).toBeNull()
})
