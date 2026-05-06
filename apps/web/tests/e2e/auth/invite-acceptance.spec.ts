import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { TEST_USER, TEST_ORG } from '../fixtures/seed'
import { issueTestLicence } from '../fixtures/licence'

const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION !== 'false'

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

  await page.waitForURL(/\/onboarding(?:\?|$)/)
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

test('invite signup without required email verification joins the inviting organisation', async ({
  page,
}) => {
  test.skip(requireEmailVerification, 'email verification is required for this run')

  const sql = getTestDb()
  const suffix = Date.now().toString()
  const invitedEmail = `invite-signup-${suffix}@example.com`
  const invitedPassword = 'TestPassword123!'
  const inviteToken = `invite-signup-token-${suffix}`

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
      ${`invite-signup-${suffix}`},
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

  await page.goto(`/register?invite=${inviteToken}`)
  await expect(page.getByLabel('Email')).toHaveValue(invitedEmail)
  await page.getByLabel('Full name').fill('Invite Signup User')
  await page.getByLabel(/^Password$/).fill(invitedPassword)
  await page.getByLabel(/^Confirm password$/).fill(invitedPassword)
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()
  await expect(page.getByText('Create your organisation', { exact: true })).toHaveCount(0)

  const [invitee] = await sql<Array<{
    organisation_id: string | null
    role: string
    roles: string[]
    email_verified: boolean
  }>>`
    SELECT organisation_id, role, roles, email_verified
    FROM "user"
    WHERE email = ${invitedEmail}
    LIMIT 1
  `
  expect(invitee?.organisation_id).not.toBeNull()
  expect(invitee?.role).toBe('org_admin')
  expect(invitee?.roles).toEqual(['org_admin'])
  expect(invitee?.email_verified).toBe(false)

  const [invite] = await sql<Array<{ accepted_at: Date | null; email: string; token: string }>>`
    SELECT accepted_at, email, token
    FROM invitations
    WHERE token = ${inviteToken}
    LIMIT 1
  `
  expect(invite?.accepted_at).not.toBeNull()
  expect(invite?.email).toBe(invitedEmail)
  expect(invite?.token).toBe(inviteToken)
})

test('authenticated invited user without an organisation redeems invite link instead of onboarding', async ({
  page,
}) => {
  const sql = getTestDb()
  const suffix = Date.now().toString()
  const invitedEmail = `signed-in-invitee-${suffix}@example.com`
  const invitedPassword = 'TestPassword123!'
  const inviteToken = `signed-in-invite-token-${suffix}`

  const signUpResponse = await page.request.post('/api/auth/sign-up/email', {
    data: {
      email: invitedEmail,
      password: invitedPassword,
      name: 'Signed In Invitee',
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
      ${`signed-in-invite-${suffix}`},
      ${invitedEmail},
      'engineer',
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

  await page.goto(`/register?invite=${inviteToken}`)
  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('dashboard-heading')).toBeVisible()

  const [invitee] = await sql<Array<{ organisation_id: string | null; role: string }>>`
    SELECT organisation_id, role
    FROM "user"
    WHERE email = ${invitedEmail}
    LIMIT 1
  `
  expect(invitee?.organisation_id).not.toBeNull()
  expect(invitee?.role).toBe('engineer')

  const [invite] = await sql<Array<{ accepted_at: Date | null }>>`
    SELECT accepted_at
    FROM invitations
    WHERE token = ${inviteToken}
    LIMIT 1
  `
  expect(invite?.accepted_at).not.toBeNull()
})

test('invite acceptance rejects when no user seat is available', async ({ page }) => {
  const sql = getTestDb()
  const suffix = Date.now().toString()
  const invitedEmail = `seat-limited-invitee-${suffix}@example.com`
  const invitedPassword = 'TestPassword123!'
  const inviteToken = `seat-limited-invite-token-${suffix}`

  const [org] = await sql<Array<{ id: string }>>`
    SELECT id
    FROM organisations
    WHERE slug = ${TEST_ORG.slug}
    LIMIT 1
  `
  expect(org?.id).toBeTruthy()

  try {
    const licenceKey = await issueTestLicence({ orgId: org!.id, tier: 'community', maxUsers: 1 })
    await sql`
      UPDATE organisations
      SET licence_key = ${licenceKey},
          licence_tier = 'community'
      WHERE id = ${org!.id}
    `

    const signUpResponse = await page.request.post('/api/auth/sign-up/email', {
      data: {
        email: invitedEmail,
        password: invitedPassword,
        name: 'Seat Limited Invitee',
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
        ${`seat-limited-invite-${suffix}`},
        ${invitedEmail},
        'engineer',
        ${inviteToken},
        ${org!.id},
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

    const [invitee] = await sql<Array<{ organisation_id: string | null }>>`
      SELECT organisation_id
      FROM "user"
      WHERE email = ${invitedEmail}
      LIMIT 1
    `
    expect(invitee?.organisation_id).toBeNull()

    const [invite] = await sql<Array<{ accepted_at: Date | null }>>`
      SELECT accepted_at
      FROM invitations
      WHERE token = ${inviteToken}
      LIMIT 1
    `
    expect(invite?.accepted_at).toBeNull()
  } finally {
    await sql`
      UPDATE organisations
      SET licence_key = NULL,
          licence_tier = 'community'
      WHERE id = ${org!.id}
    `
  }
})
