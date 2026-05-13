import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(
  path.join(repoRoot, 'app/(dashboard)/hosts/[id]/settings-tab.tsx'),
  'utf8',
)

test('host settings tab exposes Docker retention override controls', () => {
  assert.match(source, /getHostDockerRetentionSettings/)
  assert.match(source, /updateHostDockerRetentionOverride/)
  assert.match(source, /settings-docker-retention-override-select/)
  assert.match(source, /settings-docker-retention-inherited/)
  assert.match(source, /settings-docker-retention-clear/)
})
