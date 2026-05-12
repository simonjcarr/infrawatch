import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const repoFile = (path) => new URL(`../../../${path}`, import.meta.url)

test('start scripts send the Ansible settings query to psql stdin', () => {
  for (const path of ['start.sh', 'deploy/customer-bundle/start.sh']) {
    const script = readFileSync(repoFile(path), 'utf8')

    assert.match(script, /should_start_ansible_profile\(\)/)
    assert.match(script, /<<'SQL'/)
    assert.doesNotMatch(script, /-c "SELECT CASE WHEN EXISTS/)
    assert.match(script, /WHERE id = :'instance_id'/)
    assert.match(script, /metadata->'featureFlags'->>'automation\.ansible'/)
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

test('customer bundle start script handles the no-profile startup path without expanding an unset array', () => {
  const script = readFileSync(repoFile('deploy/customer-bundle/start.sh'), 'utf8')

  assert.match(script, /local -a compose_profile_args=\(\)/)
  assert.match(script, /if \[ \$\{#compose_profile_args\[@\]\} -gt 0 \]; then/)
  assert.match(script, /docker compose up -d/)
  assert.doesNotMatch(script, /if ! docker compose "\$\{compose_profile_args\[@\]\}" up -d; then/)
})
