import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAgentInstallCommand,
  buildAgentInstallScript,
  buildAgentInstallUrl,
} from './install-script.ts'

test('buildAgentInstallUrl never places enrolment tokens in the installer URL', () => {
  const url = buildAgentInstallUrl('https://ct-ops.example.com/', false)

  assert.equal(url, 'https://ct-ops.example.com/api/agent/install')
  assert.equal(url.includes('token='), false)
})

test('buildAgentInstallCommand downloads the script without embedding secrets', () => {
  const command = buildAgentInstallCommand('https://ct-ops.example.com', true)

  assert.equal(command, 'curl -fsSL "https://ct-ops.example.com/api/agent/install?skip_verify=true" | sh')
  assert.equal(command.includes('token='), false)
  assert.equal(command.includes('CT_OPS_ORG_TOKEN='), false)
})

test('buildAgentInstallScript only consumes CT_OPS_ORG_TOKEN from the runtime environment', () => {
  const script = buildAgentInstallScript('https://ct-ops.example.com', 'ct-ops.example.com:9443', false)

  assert.match(script, /if \[ -n "\$\{CT_OPS_ORG_TOKEN:-\}" \]; then/)
  assert.match(script, /sudo env CT_OPS_ORG_TOKEN="\$CT_OPS_ORG_TOKEN" \.\/ct-ops-agent --install --address "ct-ops\.example\.com:9443"/)
  assert.equal(script.includes('token='), false)
})
