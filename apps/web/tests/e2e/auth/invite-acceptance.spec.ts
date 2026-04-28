import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER, TEST_ORG } from '../fixtures/seed'

test('invite acceptance rejects logged-in users whose email does not match the invitation', async ({
  page,
}) => {
  const sql = getTestDb()
  const suffix = Date.now().toString()
  const attackerEmail = `attacker-${suffix}@example.com`
  const attackerPassword = 'TestPassword123!'
  const invitedEmail = `victim-${suffix}@example.com`
  const inviteToken = `invite-token-${suffix}`

  await page.request.post('/api/auth/sign-up/email', {
    data: {
      email: attackerEmail,
      password: attackerPassword,
      name: 'Invite Attacker',
    },
  })

  await sql`
    UPDATE "user"
    SET email_verified = true,
        is_active = true
    WHERE email = ${attackerEmail}
  `

  await sql`
    INSERT INTO invitations (
      id,
      email,
      role,
      token,
      organisation_id,
      invited_by_id,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (
      ${`invite-${suffix}`},
      ${invitedEmail},
      'org_admin',
      ${inviteToken},
      (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
      (SELECT id FROM "user" WHERE email = ${TEST_USER.email}),
      NOW() + INTERVAL '1 day',
      NOW(),
      NOW()
    )
  `

  const signInResponse = await page.request.post('/api/auth/sign-in/email', {
    data: {
      email: attackerEmail,
      password: attackerPassword,
    },
  })
  expect(signInResponse.ok()).toBeTruthy()

  await page.goto('/onboarding')
  await page.waitForURL('**/onboarding')

  await page.goto(`/accept-invite?token=${inviteToken}`)

  await page.waitForURL('**/onboarding')
  await expect(page.getByText('Create your organisation', { exact: true })).toBeVisible()

  const [attacker] = await sql<Array<{ organisation_id: string | null; role: string }>>`
    SELECT organisation_id, role
    FROM "user"
    WHERE email = ${attackerEmail}
    LIMIT 1
  `
  expect(attacker?.organisation_id).toBeNull()
  expect(attacker?.role).toBe('engineer')

  const [invite] = await sql<Array<{ accepted_at: Date | null }>>`
    SELECT accepted_at
    FROM invitations
    WHERE token = ${inviteToken}
    LIMIT 1
  `
  expect(invite?.accepted_at).toBeNull()
})

test('invite acceptance attaches the matching user to the organisation', async ({ page }) => {
  const sql = getTestDb()
  const suffix = Date.now().toString()
  const invitedEmail = `invitee-${suffix}@example.com`
  const invitedPassword = 'TestPassword123!'
  const inviteToken = `invite-token-${suffix}`

  const signUpResponse = await page.request.post('/api/auth/sign-up/email', {
    data: {
      email: invitedEmail,
      password: invitedPassword,
      name: 'Invited User',
    },
  })
  expect(signUpResponse.ok()).toBeTruthy()

  await sql`
    UPDATE "user"
    SET email_verified = true,
        is_active = true
    WHERE email = ${invitedEmail}
  `

  await sql`
    INSERT INTO invitations (
      id,
      email,
      role,
      token,
      organisation_id,
      invited_by_id,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (
      ${`invite-success-${suffix}`},
      ${invitedEmail},
      'org_admin',
      ${inviteToken},
      (SELECT id FROM organisations WHERE slug = ${TEST_ORG.slug}),
      (SELECT id FROM "user" WHERE email = ${TEST_USER.email}),
      NOW() + INTERVAL '1 day',
      NOW(),
      NOW()
    )
  `

  const signInResponse = await page.request.post('/api/auth/sign-in/email', {
    data: {
      email: invitedEmail,
      password: invitedPassword,
    },
  })
  expect(signInResponse.ok()).toBeTruthy()

  await page.goto(`/accept-invite?token=${inviteToken}`)
  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()

  const [invitee] = await sql<Array<{ organisation_id: string | null; role: string }>>`
    SELECT organisation_id, role
    FROM "user"
    WHERE email = ${invitedEmail}
    LIMIT 1
  `
  expect(invitee?.organisation_id).not.toBeNull()
  expect(invitee?.role).toBe('org_admin')

  const [invite] = await sql<Array<{ accepted_at: Date | null }>>`
    SELECT accepted_at
    FROM invitations
    WHERE token = ${inviteToken}
    LIMIT 1
  `
  expect(invite?.accepted_at).not.toBeNull()
})
