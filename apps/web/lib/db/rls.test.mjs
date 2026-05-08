import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { GenericContainer, Wait } from 'testcontainers'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { asc, eq } from 'drizzle-orm'

const here = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.resolve(here, '..', '..')
const migrationsFolder = path.join(webDir, 'lib', 'db', 'migrations')

test('org-scoped database context enforces RLS for organisation_id tables', async () => {
  const container = await new GenericContainer('timescale/timescaledb:latest-pg16')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'ctops_test',
    })
    .withExposedPorts(5432)
    .withTmpFs({ '/var/lib/postgresql/data': 'rw,size=256m' })
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()

  try {
    const adminDatabaseUrl =
      `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/ctops_test`
    const appDatabaseUrl =
      `postgres://app_user:app_password@${container.getHost()}:${container.getMappedPort(5432)}/ctops_test`

    const migrationClient = postgres(adminDatabaseUrl, { prepare: false, max: 1 })
    try {
      await migrate(drizzle(migrationClient), { migrationsFolder })
      await migrationClient.unsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user LOGIN PASSWORD 'app_password';
          END IF;
        END
        $$;
      `)
      await migrationClient.unsafe('GRANT USAGE ON SCHEMA public TO app_user')
      await migrationClient.unsafe('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user')
      await migrationClient.unsafe('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user')
      await migrationClient.unsafe(`
        INSERT INTO organisations (id, name, slug)
        VALUES
          ('org-a', 'Org A', 'org-a'),
          ('org-b', 'Org B', 'org-b'),
          ('org-c', 'Org C', 'org-c')
      `)
      await migrationClient.unsafe(`
        INSERT INTO tags (id, organisation_id, key, value, usage_count)
        VALUES
          ('tag-a', 'org-a', 'env', 'prod', 1),
          ('tag-b', 'org-b', 'env', 'dev', 1)
      `)
      await migrationClient.unsafe(`
        INSERT INTO ct_cve_connector_settings (
          organisation_id,
          enabled,
          name,
          base_url,
          inventory_token_id,
          inventory_token_secret_encrypted,
          ct_cve_token_id,
          ct_cve_token_secret_encrypted
        )
        VALUES
          ('org-a', true, 'CT-CVE A', 'https://ct-cve-a.example.test', 'inventory-a', 'encrypted-inventory-a', 'ctcve-a', 'encrypted-ctcve-a'),
          ('org-b', true, 'CT-CVE B', 'https://ct-cve-b.example.test', 'inventory-b', 'encrypted-inventory-b', 'ctcve-b', 'encrypted-ctcve-b')
      `)
      await migrationClient.unsafe(`
        INSERT INTO "user" (id, name, email, email_verified, organisation_id, role, is_active)
        VALUES
          ('user-a', 'User A', 'user-a@example.com', true, 'org-a', 'admin', true),
          ('user-b', 'User B', 'user-b@example.com', true, 'org-b', 'admin', true)
      `)
      await migrationClient.unsafe(`
        INSERT INTO "session" (id, expires_at, token, user_id)
        VALUES
          ('session-a', now() + interval '1 day', 'token-a', 'user-a'),
          ('session-b', now() + interval '1 day', 'token-b', 'user-b')
      `)
      await migrationClient.unsafe(`
        INSERT INTO account (id, account_id, provider_id, user_id, password, access_token, refresh_token)
        VALUES
          ('account-a', 'account-a', 'credential', 'user-a', 'hash-a', 'access-a', 'refresh-a'),
          ('account-b', 'account-b', 'credential', 'user-b', 'hash-b', 'access-b', 'refresh-b')
      `)
      await migrationClient.unsafe(`
        INSERT INTO totp_credential (id, user_id, secret, backup_codes)
        VALUES
          ('totp-a', 'user-a', 'secret-a', 'backup-a'),
          ('totp-b', 'user-b', 'secret-b', 'backup-b')
      `)
      await migrationClient.unsafe(`
        INSERT INTO verification (id, identifier, value, expires_at)
        VALUES
          ('verification-a', 'user-a@example.com', 'verification-token-a', now() + interval '1 day'),
          ('verification-b', 'user-b@example.com', 'verification-token-b', now() + interval '1 day')
      `)
    } finally {
      await migrationClient.end()
    }

    process.env.DATABASE_URL = appDatabaseUrl

    const [{ db, withOrgDatabaseScope }, schema] = await Promise.all([
      import(pathToFileURL(path.join(webDir, 'lib', 'db', 'index.ts')).href),
      import(pathToFileURL(path.join(webDir, 'lib', 'db', 'schema', 'index.ts')).href),
    ])

    const unscopedRows = await db.query.tags.findMany({
      orderBy: [asc(schema.tags.id)],
    })
    assert.deepEqual(unscopedRows.map((row) => row.id), [])

    const unscopedSessions = await db.query.sessions.findMany({
      orderBy: [asc(schema.sessions.id)],
    })
    assert.deepEqual(unscopedSessions.map((row) => row.id), [])

    const unscopedCtCveConnectorSettings = await db.query.ctCveConnectorSettings.findMany({
      orderBy: [asc(schema.ctCveConnectorSettings.organisationId)],
    })
    assert.deepEqual(unscopedCtCveConnectorSettings.map((row) => row.organisationId), [])

    const authBootstrapClient = postgres(`${appDatabaseUrl}?options=-c%20app.auth_bootstrap%3Don`, {
      prepare: false,
      max: 1,
    })
    try {
      const authBootstrapDb = drizzle(authBootstrapClient, { schema })
      const bootstrapSessions = await authBootstrapDb.query.sessions.findMany({
        where: eq(schema.sessions.token, 'token-a'),
        orderBy: [asc(schema.sessions.id)],
      })
      assert.deepEqual(bootstrapSessions.map((row) => row.id), ['session-a'])

      const bootstrapAccounts = await authBootstrapDb.query.accounts.findMany({
        where: eq(schema.accounts.userId, 'user-a'),
        orderBy: [asc(schema.accounts.id)],
      })
      assert.deepEqual(bootstrapAccounts.map((row) => row.id), ['account-a'])

      const bootstrapTotpCredentials = await authBootstrapDb.query.totpCredentials.findMany({
        where: eq(schema.totpCredentials.userId, 'user-a'),
        orderBy: [asc(schema.totpCredentials.id)],
      })
      assert.deepEqual(bootstrapTotpCredentials.map((row) => row.id), ['totp-a'])

      const bootstrapVerifications = await authBootstrapDb.query.verifications.findMany({
        where: eq(schema.verifications.identifier, 'user-a@example.com'),
        orderBy: [asc(schema.verifications.id)],
      })
      assert.deepEqual(bootstrapVerifications.map((row) => row.id), ['verification-a'])
    } finally {
      await authBootstrapClient.end()
    }

    await assert.rejects(
      db.insert(schema.tags).values({
        id: 'tag-unscoped',
        organisationId: 'org-a',
        key: 'team',
        value: 'ops',
        usageCount: 0,
      }),
      (error) => {
        assert.match(error.message, /Failed query: insert into "tags"/)
        return true
      },
    )

    const orgRows = await withOrgDatabaseScope('org-a', async (scopedDb) =>
      scopedDb.query.tags.findMany({
        where: eq(schema.tags.key, 'env'),
        orderBy: [asc(schema.tags.id)],
      }),
    )
    assert.deepEqual(orgRows.map((row) => row.id), ['tag-a'])

    const orgCtCveConnectorSettings = await withOrgDatabaseScope('org-a', async (scopedDb) =>
      scopedDb.query.ctCveConnectorSettings.findMany({
        orderBy: [asc(schema.ctCveConnectorSettings.organisationId)],
      }),
    )
    assert.deepEqual(orgCtCveConnectorSettings.map((row) => row.organisationId), ['org-a'])

    const orgSessions = await withOrgDatabaseScope('org-a', async (scopedDb) =>
      scopedDb.query.sessions.findMany({ orderBy: [asc(schema.sessions.id)] }),
    )
    assert.deepEqual(orgSessions.map((row) => row.id), ['session-a'])

    const orgAccounts = await withOrgDatabaseScope('org-a', async (scopedDb) =>
      scopedDb.query.accounts.findMany({ orderBy: [asc(schema.accounts.id)] }),
    )
    assert.deepEqual(orgAccounts.map((row) => row.id), ['account-a'])

    const orgTotpCredentials = await withOrgDatabaseScope('org-a', async (scopedDb) =>
      scopedDb.query.totpCredentials.findMany({ orderBy: [asc(schema.totpCredentials.id)] }),
    )
    assert.deepEqual(orgTotpCredentials.map((row) => row.id), ['totp-a'])

    const orgVerifications = await withOrgDatabaseScope('org-a', async (scopedDb) =>
      scopedDb.query.verifications.findMany({ orderBy: [asc(schema.verifications.id)] }),
    )
    assert.deepEqual(orgVerifications.map((row) => row.id), ['verification-a'])

    await assert.rejects(
      withOrgDatabaseScope('org-a', async (scopedDb) => {
        await scopedDb.insert(schema.tags).values({
          id: 'tag-cross-org',
          organisationId: 'org-c',
          key: 'team',
          value: 'security',
          usageCount: 0,
        })
      }),
      (error) => {
        assert.match(error.message, /Failed query: insert into "tags"/)
        return true
      },
    )

    await assert.rejects(
      withOrgDatabaseScope('org-a', async (scopedDb) => {
        await scopedDb.insert(schema.ctCveConnectorSettings).values({
          organisationId: 'org-c',
          enabled: true,
          name: 'Cross-org CT-CVE',
          baseUrl: 'https://ct-cve-cross.example.test',
          inventoryTokenId: 'inventory-cross',
          inventoryTokenSecretEncrypted: 'encrypted-inventory-cross',
          ctCveTokenId: 'ctcve-cross',
          ctCveTokenSecretEncrypted: 'encrypted-ctcve-cross',
        })
      }),
      (error) => {
        assert.match(error.message, /Failed query: insert into "ct_cve_connector_settings"/)
        return true
      },
    )

    await assert.rejects(
      withOrgDatabaseScope('org-a', async (scopedDb) => {
        await scopedDb.insert(schema.sessions).values({
          id: 'session-cross-org',
          expiresAt: new Date(Date.now() + 86_400_000),
          token: 'token-cross-org',
          userId: 'user-b',
        })
      }),
      (error) => {
        assert.match(error.message, /Failed query: insert into "session"/)
        return true
      },
    )

    const verificationClient = postgres(adminDatabaseUrl, { prepare: false, max: 1 })
    try {
      const untouchedOrgBRow = await verificationClient`
        select id
        from tags
        where id = 'tag-b' and organisation_id = 'org-b'
      `
      assert.equal(untouchedOrgBRow.length, 1)
    } finally {
      await verificationClient.end()
    }
  } finally {
    await container.stop()
  }
}, 120_000)
