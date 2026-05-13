import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_INSTANCE } from '../fixtures/seed'
import { issueTestLicence } from '../fixtures/licence'

async function getInstanceId(sql: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM instance_settings
    WHERE slug = ${TEST_INSTANCE.slug}
    LIMIT 1
  `
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

async function setInstanceSeatLimit(sql: ReturnType<typeof getTestDb>, instanceId: string, maxUsers: number): Promise<void> {
  const licenceKey = await issueTestLicence({ instanceId, tier: 'community', maxUsers })
  await sql`
    UPDATE instance_settings
    SET licence_key = ${licenceKey},
        licence_tier = 'community'
    WHERE id = ${instanceId}
  `
}

async function clearInstanceLicence(sql: ReturnType<typeof getTestDb>, instanceId: string): Promise<void> {
  await sql`
    UPDATE instance_settings
    SET licence_key = NULL,
        licence_tier = 'community'
    WHERE id = ${instanceId}
  `
}

async function insertActiveMember(
  sql: ReturnType<typeof getTestDb>,
  instanceId: string,
  id: string,
  email: string,
): Promise<void> {
  await sql`
    INSERT INTO "user" (
      id,
      name,
      email,
      email_verified,
      instance_id,
      role,
      roles,
      is_active,
      deleted_at
    )
    VALUES (
      ${id},
      ${email},
      ${email},
      true,
      ${instanceId},
      'engineer',
      '["engineer"]'::jsonb,
      true,
      NULL
    )
  `
}

async function countActiveMembers(sql: ReturnType<typeof getTestDb>, instanceId: string): Promise<number> {
  const [row] = await sql<Array<{ count: string }>>`
    SELECT COUNT(*)::text AS count
    FROM "user"
    WHERE instance_id = ${instanceId}
      AND is_active = true
      AND deleted_at IS NULL
  `
  return Number.parseInt(row?.count ?? '0', 10)
}

async function ensureAtLeastActiveMembers(
  sql: ReturnType<typeof getTestDb>,
  instanceId: string,
  targetCount: number,
  idPrefix: string,
): Promise<number> {
  let activeCount = await countActiveMembers(sql, instanceId)
  for (let index = activeCount; index < targetCount; index += 1) {
    const id = `${idPrefix}-${index + 1}`
    await insertActiveMember(sql, instanceId, id, `${id}@example.com`)
    activeCount += 1
  }
  return activeCount
}

test('admin can create and cancel a team invitation', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const inviteeEmail = 'teammate@example.com'

  await page.goto('/team')

  await expect(page.getByTestId('team-heading')).toBeVisible()
  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role-instance_admin').click()
  await page.getByTestId('team-invite-role-read_only').click()
  await page.getByTestId('team-invite-submit').click()

  const inviteLink = page.getByTestId('team-invite-link')
  await expect(inviteLink).toBeVisible()
  await expect(inviteLink).toHaveValue(/\/register\?invite=/)
  await page.getByTestId('team-invite-done').click()

  const pendingInviteRow = page.getByTestId('team-pending-invite-row').filter({ hasText: inviteeEmail })
  await expect(pendingInviteRow).toBeVisible()
  await expect(pendingInviteRow).toContainText('Instance Admin')
  await expect(pendingInviteRow).toContainText('Read Only')

  const inviteRows = await sql<Array<{ id: string; role: string; roles: string[]; deleted_at: Date | null }>>`
    SELECT id, role, roles, deleted_at
    FROM invitations
    WHERE instance_id = ${instanceId}
      AND email = ${inviteeEmail}
    ORDER BY created_at DESC
    LIMIT 1
  `

  expect(inviteRows).toHaveLength(1)
  expect(inviteRows[0]?.role).toBe('instance_admin')
  expect(inviteRows[0]?.roles).toEqual(['instance_admin', 'read_only'])
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
  const instanceId = await getInstanceId(sql)
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
  await page.getByTestId('team-invite-role-instance_admin').click()
  await page.getByTestId('team-invite-submit').click()

  await expect(page.getByText('An invitation has already been sent to this email address')).toBeVisible()
  await expect(page.getByTestId('team-invite-link')).toHaveCount(0)

  const inviteRows = await sql<Array<{ role: string; roles: string[]; deleted_at: Date | null }>>`
    SELECT role, roles, deleted_at
    FROM invitations
    WHERE instance_id = ${instanceId}
      AND email = ${inviteeEmail}
    ORDER BY created_at ASC
  `

  expect(inviteRows).toHaveLength(1)
  expect(inviteRows[0]?.role).toBe('engineer')
  expect(inviteRows[0]?.roles).toEqual(['engineer'])
  expect(inviteRows[0]?.deleted_at).toBeNull()
})

test('admin cannot create a fourth user invite on free Community seats', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const suffix = Date.now().toString()
  const inviteeEmail = `community-fourth-seat-${suffix}@example.com`

  await clearInstanceLicence(sql, instanceId)
  await ensureAtLeastActiveMembers(sql, instanceId, 3, `community-seat-member-${suffix}`)

  await page.goto('/team')

  await expect(page.getByTestId('team-heading')).toBeVisible()
  await page.getByTestId('team-invite-open').click()
  await page.getByTestId('team-invite-email').fill(inviteeEmail)
  await page.getByTestId('team-invite-role-engineer').click()
  await page.getByTestId('team-invite-submit').click()

  await expect(page.getByText('User seat limit reached. This licence allows 3 users.')).toBeVisible()
  await expect(page.getByTestId('team-invite-link')).toHaveCount(0)
})

test('an extra paid seat allows one more active user invitation', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const suffix = Date.now().toString()
  const inviteeEmail = `paid-fourth-seat-${suffix}@example.com`

  try {
    const activeCount = await ensureAtLeastActiveMembers(sql, instanceId, 3, `paid-seat-member-${suffix}`)
    await setInstanceSeatLimit(sql, instanceId, activeCount + 1)

    await page.goto('/team')

    await expect(page.getByTestId('team-heading')).toBeVisible()
    await page.getByTestId('team-invite-open').click()
    await page.getByTestId('team-invite-email').fill(inviteeEmail)
    await page.getByTestId('team-invite-role-engineer').click()
    await page.getByTestId('team-invite-submit').click()

    await expect(page.getByTestId('team-invite-link')).toBeVisible()
    await page.getByTestId('team-invite-done').click()
    await expect(page.getByTestId('team-pending-invite-row').filter({ hasText: inviteeEmail })).toBeVisible()
  } finally {
    await clearInstanceLicence(sql, instanceId)
  }
})

test('admin cannot create an invitation when user seats are exhausted', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)

  try {
    await setInstanceSeatLimit(sql, instanceId, 1)

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
      WHERE instance_id = ${instanceId}
        AND email = 'seat-limited-teammate@example.com'
    `
    expect(inviteRows).toHaveLength(0)
  } finally {
    await clearInstanceLicence(sql, instanceId)
  }
})

test('admin re-inviting a removed user restores their membership instead of creating a pending invite', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const instanceId = await getInstanceId(sql)
  const removedEmail = 'restored-member@example.com'

  const activeCount = await countActiveMembers(sql, instanceId)

  try {
    await setInstanceSeatLimit(sql, instanceId, activeCount + 1)

    await sql`
      INSERT INTO "user" (
        id,
        name,
        email,
        email_verified,
        instance_id,
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
        ${instanceId},
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
      WHERE instance_id = ${instanceId}
        AND email = ${removedEmail}
    `

    expect(inviteRows).toHaveLength(0)
  } finally {
    await clearInstanceLicence(sql, instanceId)
  }
})
