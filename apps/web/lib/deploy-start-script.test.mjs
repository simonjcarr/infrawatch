import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const repoFile = (path) => new URL(`../../../${path}`, import.meta.url)

test('start scripts do not auto-orchestrate Ansible modules', () => {
  for (const path of ['start.sh', 'deploy/customer-bundle/start.sh']) {
    const script = readFileSync(repoFile(path), 'utf8')

    assert.doesNotMatch(script, /should_start_ansible_profile/)
    assert.doesNotMatch(script, /metadata->'featureFlags'->>'automation\.ansible'/)
    assert.doesNotMatch(script, /--profile ansible up/)
  }
})

test('customer bundle start script checks nginx ports after shutting down the old stack', () => {
  const script = readFileSync(repoFile('deploy/customer-bundle/start.sh'), 'utf8')

  const downIndex = script.indexOf('docker compose down --remove-orphans')
  const portCheckIndex = script.lastIndexOf('check_ports_free')

  assert.notEqual(downIndex, -1)
  assert.notEqual(portCheckIndex, -1)
  assert.ok(downIndex < portCheckIndex, 'expected port check to run after docker compose down')
})

test('customer bundle start script uses the base compose startup path', () => {
  const script = readFileSync(repoFile('deploy/customer-bundle/start.sh'), 'utf8')

  assert.match(script, /docker compose up -d/)
  assert.doesNotMatch(script, /compose_profile_args/)
})
