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
