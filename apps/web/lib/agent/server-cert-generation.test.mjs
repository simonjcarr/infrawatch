import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

test('generated server certificates include the bundled ct-ops hostname', () => {
  execFileSync('bash', [resolve(repoRoot, 'deploy/scripts/test-gen-server-cert.sh')], {
    cwd: repoRoot,
    stdio: 'pipe',
  })
})
