import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { GenericContainer, Wait } from 'testcontainers'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

import { verifyCtCveServiceRequest } from './service-token.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.resolve(here, '..', '..', '..')
const migrationsFolder = path.join(webDir, 'lib', 'db', 'migrations')

const TOKEN = {
  id: 'ctcve_db_nonce_token',
  secret: Buffer.from('ct-cve database nonce test signing key').toString('base64url'),
  instanceId: 'org_db_nonce',
  scopes: ['findings:write'],
}

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function signedHeaders({ body, timestamp, nonce }) {
  const bodyHash = sha256(body)
  const input = `POST\n/api/integrations/ct-cve/v1/finding-batches\n${timestamp}\n${nonce}\n${bodyHash}`
  const signature = createHmac('sha256', TOKEN.secret).update(input).digest('base64url')

  return {
    authorization: `CT-ServiceToken ${TOKEN.id}`,
    'x-ct-timestamp': timestamp,
    'x-ct-nonce': nonce,
    'x-ct-content-sha256': bodyHash,
    'x-ct-signature': `v1=${signature}`,
  }
}

test('default CT-CVE nonce store rejects replays across verifier instances', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
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
    const databaseUrl =
      `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/ctops_test`
    const migrationClient = postgres(databaseUrl, { prepare: false, max: 1 })
    try {
      await migrate(drizzle(migrationClient), { migrationsFolder })
    } finally {
      await migrationClient.end()
    }

    process.env.DATABASE_URL = databaseUrl

    const body = JSON.stringify({ instanceId: TOKEN.instanceId })
    const timestamp = '2026-04-30T09:20:00.000Z'
    const request = {
      method: 'POST',
      path: '/api/integrations/ct-cve/v1/finding-batches',
      body,
      headers: signedHeaders({ body, timestamp, nonce: 'shared_nonce' }),
      requiredScope: 'findings:write',
      instanceId: TOKEN.instanceId,
      now: new Date('2026-04-30T09:20:30.000Z'),
      tokens: [TOKEN],
    }

    const firstReplica = await verifyCtCveServiceRequest(request)
    const secondReplica = await verifyCtCveServiceRequest(request)

    assert.equal(firstReplica.ok, true)
    assert.equal(secondReplica.ok, false)
    assert.equal(!secondReplica.ok && secondReplica.error.code, 'replayed_nonce')

    const { client } = await import(pathToFileURL(path.join(webDir, 'lib', 'db', 'index.ts')).href)
    await client.end()
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
    await container.stop()
  }
}, 120_000)
