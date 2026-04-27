#!/usr/bin/env node
// E2E runner: starts the TimescaleDB testcontainer and runs migrations
// BEFORE Playwright is invoked, so DATABASE_URL is already present in the
// environment when Playwright spawns its webServer. Seeding runs inside
// Playwright as a "setup" project once webServer is ready.
//
// Why this exists: Playwright's `globalSetup` runs concurrently with its
// `webServer`, so setting DATABASE_URL there is too late — Next.js starts
// with a missing env var. This wrapper inverts the order.

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GenericContainer, Wait } from 'testcontainers'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const here = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.resolve(here, '..', '..')
const port = Number(process.env.E2E_PORT ?? 3100)
const appUrl = `http://localhost:${port}`
const authEmailCaptureFile = path.join(webDir, 'tests', 'e2e', '.tmp', 'auth-emails.ndjson')

async function main() {
  console.log('[e2e] starting TimescaleDB container (tmpfs)')
  const container = await new GenericContainer('timescale/timescaledb:latest-pg16')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'ctops_test',
    })
    .withExposedPorts(5432)
    .withTmpFs({ '/var/lib/postgresql/data': 'rw,size=512m' })
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()

  let exitCode = 1
  try {
    const host = container.getHost()
    const mappedPort = container.getMappedPort(5432)
    const databaseUrl = `postgres://test:test@${host}:${mappedPort}/ctops_test`

    process.env.DATABASE_URL = databaseUrl
    process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'e2e-test-secret-do-not-use-in-prod'
    process.env.BETTER_AUTH_URL = appUrl
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = appUrl
    process.env.E2E_PORT = String(port)
    process.env.AUTH_EMAIL_CAPTURE_FILE = authEmailCaptureFile
    process.env.E2E_DISABLE_AGENT_CACHE_PREWARM = '1'

    await mkdir(path.dirname(authEmailCaptureFile), { recursive: true })
    await rm(authEmailCaptureFile, { force: true })

    console.log('[e2e] running migrations')
    const migrationClient = postgres(databaseUrl, { prepare: false, max: 1 })
    try {
      await migrate(drizzle(migrationClient), {
        migrationsFolder: path.join(webDir, 'lib', 'db', 'migrations'),
      })
    } finally {
      await migrationClient.end()
    }

    const pwArgs = process.argv.slice(2)
    console.log('[e2e] running: playwright test', pwArgs.join(' '))
    exitCode = await runPlaywright(pwArgs)
  } finally {
    console.log('[e2e] stopping container')
    try {
      await container.stop()
    } catch (err) {
      console.warn('[e2e] container.stop() failed:', err)
    }
  }

  process.exit(exitCode)
}

function runPlaywright(args) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'playwright', 'test', ...args], {
      cwd: webDir,
      stdio: 'inherit',
      env: process.env,
    })
    const forward = (sig) => child.kill(sig)
    process.on('SIGINT', forward)
    process.on('SIGTERM', forward)
    child.on('exit', (code) => resolve(code ?? 0))
  })
}

main().catch((err) => {
  console.error('[e2e] runner failed:', err)
  process.exit(1)
})
