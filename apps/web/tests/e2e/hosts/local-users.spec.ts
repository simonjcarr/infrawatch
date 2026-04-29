import { test, expect } from '../fixtures/test'
import { getTestDb } from '../fixtures/db'
import { issueTestLicence } from '../fixtures/licence'
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

test('authenticated user can review host local users and open a user detail page', async ({ authenticatedPage: page }) => {
  const sql = getTestDb()
  const orgId = await getOrgId(sql)
  const licenceKey = await issueTestLicence({
    orgId,
    features: ['serviceAccountTracker'],
  })

  await sql`
    UPDATE organisations
    SET licence_key = ${licenceKey},
        licence_tier = 'pro'
    WHERE id = ${orgId}
  `

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
      last_seen_at,
      metadata
    )
    VALUES (
      'local-users-host',
      ${orgId},
      'local-users-node',
      'Local Users Node',
      'Linux',
      'x86_64',
      '["10.50.0.10"]'::jsonb,
      'online',
      NOW(),
      '{"collectionSettings":{"cpu":true,"memory":true,"disk":true,"localUsers":true}}'::jsonb
    )
  `

  await sql`
    INSERT INTO service_accounts (
      id,
      organisation_id,
      host_id,
      username,
      uid,
      gid,
      home_directory,
      shell,
      account_type,
      has_login_capability,
      has_running_processes,
      status,
      account_locked,
      password_expires_at,
      password_last_changed_at,
      first_seen_at,
      last_seen_at
    )
    VALUES
      (
        'local-user-alice',
        ${orgId},
        'local-users-host',
        'alice-admin',
        1001,
        1001,
        '/home/alice',
        '/bin/bash',
        'human',
        true,
        true,
        'active',
        false,
        NOW() + INTERVAL '30 days',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '20 days',
        NOW() - INTERVAL '5 minutes'
      ),
      (
        'local-user-backup',
        ${orgId},
        'local-users-host',
        'backup-svc',
        998,
        998,
        '/var/lib/backup',
        '/usr/sbin/nologin',
        'service',
        false,
        false,
        'active',
        false,
        NULL,
        NULL,
        NOW() - INTERVAL '15 days',
        NOW() - INTERVAL '30 minutes'
      ),
      (
        'local-user-daemon',
        ${orgId},
        'local-users-host',
        'legacy-daemon',
        997,
        997,
        '/nonexistent',
        '/usr/sbin/nologin',
        'system',
        false,
        false,
        'disabled',
        true,
        NULL,
        NULL,
        NOW() - INTERVAL '40 days',
        NOW() - INTERVAL '3 hours'
      )
  `

  await sql`
    INSERT INTO ssh_keys (
      id,
      organisation_id,
      host_id,
      service_account_id,
      key_type,
      bit_length,
      fingerprint_sha256,
      comment,
      file_path,
      key_source,
      associated_username,
      status,
      key_age_seconds,
      first_seen_at,
      last_seen_at
    )
    VALUES (
      'local-user-key-alice',
      ${orgId},
      'local-users-host',
      'local-user-alice',
      'ed25519',
      256,
      'SHA256:alicefingerprint',
      'alice@local-users-node',
      '/home/alice/.ssh/authorized_keys',
      'authorized_keys',
      'alice-admin',
      'active',
      86400,
      NOW() - INTERVAL '20 days',
      NOW() - INTERVAL '5 minutes'
    )
  `

  await sql`
    INSERT INTO identity_events (
      id,
      organisation_id,
      service_account_id,
      host_id,
      event_type,
      message,
      occurred_at
    )
    VALUES (
      'local-user-event-alice',
      ${orgId},
      'local-user-alice',
      'local-users-host',
      'account_discovered',
      'Discovered during the nightly account inventory run',
      NOW() - INTERVAL '1 day'
    )
  `

  await page.goto('/hosts/local-users-host')
  await page.getByRole('button', { name: 'Management' }).click()
  await expect(page.getByRole('button', { name: 'Users' })).toBeVisible()
  await page.getByRole('button', { name: 'Users' }).click()

  await expect(page.getByRole('row', { name: /alice-admin/i })).toBeVisible()
  await expect(page.getByRole('row', { name: /backup-svc/i })).toBeVisible()
  await expect(page.getByRole('row', { name: /legacy-daemon/i })).toBeVisible()

  await page.getByPlaceholder('Search by username...').fill('backup')
  await expect(page.getByRole('row', { name: /backup-svc/i })).toBeVisible()
  await expect(page.getByRole('row', { name: /alice-admin/i })).toHaveCount(0)

  await page.getByPlaceholder('Search by username...').fill('')

  await page.getByRole('combobox').nth(0).click()
  await page.getByRole('option', { name: 'Human' }).click()
  await expect(page.getByRole('row', { name: /alice-admin/i })).toBeVisible()
  await expect(page.getByRole('row', { name: /backup-svc/i })).toHaveCount(0)

  await page.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: 'Active' }).click()
  await expect(page.getByRole('row', { name: /alice-admin/i })).toBeVisible()
  await expect(page.getByRole('row', { name: /legacy-daemon/i })).toHaveCount(0)

  await page.getByRole('row', { name: /alice-admin/i }).click()

  await expect(page).toHaveURL(/\/hosts\/local-users-host\/users\/local-user-alice$/)
  await expect(page.getByRole('heading', { name: 'alice-admin' })).toBeVisible()
  await expect(page.getByText('UID 1001 on')).toBeVisible()
  await expect(page.getByRole('link', { name: 'local-users-node' }).first()).toBeVisible()
  await expect(page.getByText('SSH Keys (1)')).toBeVisible()
  await expect(page.getByText('SHA256:alicefingerprint')).toBeVisible()
  await expect(page.getByText('/home/alice/.ssh/authorized_keys')).toBeVisible()
  await expect(page.getByText('Event Timeline')).toBeVisible()
  await expect(page.getByText('Discovered during the nightly account inventory run')).toBeVisible()
})
