import assert from 'node:assert/strict'
import test from 'node:test'

import { getDatabaseUrl } from './connection-string.ts'

test('getDatabaseUrl builds an encoded URL from POSTGRES_* environment variables', () => {
  const env = {
    POSTGRES_USER: 'ctops',
    POSTGRES_PASSWORD: 'Pyth)n2475##',
    POSTGRES_HOST: 'db',
    POSTGRES_PORT: '5432',
    POSTGRES_DB: 'ctops',
  }

  const databaseUrl = getDatabaseUrl(env)
  const parsed = new URL(databaseUrl)

  assert.equal(databaseUrl, 'postgresql://ctops:Pyth)n2475%23%23@db:5432/ctops')
  assert.equal(decodeURIComponent(parsed.password), 'Pyth)n2475##')
})

test('getDatabaseUrl prefers explicit DATABASE_URL', () => {
  const env = {
    DATABASE_URL: 'postgresql://custom:secret@example.test:5432/custom',
    POSTGRES_USER: 'ctops',
    POSTGRES_PASSWORD: 'Pyth)n2475##',
    POSTGRES_HOST: 'db',
    POSTGRES_PORT: '5432',
    POSTGRES_DB: 'ctops',
  }

  assert.equal(getDatabaseUrl(env), 'postgresql://custom:secret@example.test:5432/custom')
})
