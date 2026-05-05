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
          ('org-b', 'Org B', 'org-b')
      `)
      await migrationClient.unsafe(`
        INSERT INTO tags (id, organisation_id, key, value, usage_count)
        VALUES
          ('tag-a', 'org-a', 'env', 'prod', 1),
          ('tag-b', 'org-b', 'env', 'dev', 1)
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

    await assert.rejects(
      withOrgDatabaseScope('org-a', async (scopedDb) => {
        await scopedDb.insert(schema.tags).values({
          id: 'tag-cross-org',
          organisationId: 'org-b',
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
