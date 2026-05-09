import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { REQUIRED_AGENT_VERSION } from './version.ts'

test('required agent version follows the release manifest baked into the web image', () => {
  const candidates = [
    path.resolve(process.cwd(), '.release-please-manifest.json'),
    path.resolve(process.cwd(), '../../.release-please-manifest.json'),
  ]
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate))
  assert.ok(manifestPath, 'expected release manifest to exist')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  assert.equal(REQUIRED_AGENT_VERSION, `v${manifest.agent}`)
})
