import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

test('web Dockerfile does not declare secret-shaped auth build variables', () => {
  assert.doesNotMatch(dockerfile, /^\s*(ARG|ENV)\s+BETTER_AUTH_SECRET\b/m)
  assert.doesNotMatch(dockerfile, /^\s*(ARG|ENV)\s+BETTER_AUTH_URL\b/m)
})

test('web Dockerfile marks Next production builds before running build', () => {
  const phaseIndex = dockerfile.indexOf('ENV NEXT_PHASE=phase-production-build')
  const buildIndex = dockerfile.indexOf('RUN pnpm run build')

  assert.notEqual(phaseIndex, -1)
  assert.notEqual(buildIndex, -1)
  assert.ok(phaseIndex < buildIndex)
})
