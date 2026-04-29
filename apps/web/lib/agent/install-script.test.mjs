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

test('buildAgentInstallCommand downloads the script without embedding secrets in the URL', () => {
  const command = buildAgentInstallCommand('https://ct-ops.example.com', true)

  assert.equal(command, 'curl -fsSLk "https://ct-ops.example.com/api/agent/install?skip_verify=true" | sh')
  assert.equal(command.includes('token='), false)
  assert.equal(command.includes('CT_OPS_ORG_TOKEN='), false)
})

test('buildAgentInstallCommand can pass a newly-created token outside the URL', () => {
  const command = buildAgentInstallCommand('https://ct-ops.example.com', false, 'ctops_test_token')

  assert.equal(
    command,
    'curl -fsSL "https://ct-ops.example.com/api/agent/install" | env CT_OPS_ORG_TOKEN=\'ctops_test_token\' sh',
  )
  assert.equal(command.includes('token='), false)
  assert.match(command, /CT_OPS_ORG_TOKEN='ctops_test_token'/)
})

test('buildAgentInstallCommand shell-quotes tokens', () => {
  const command = buildAgentInstallCommand('https://ct-ops.example.com', false, "token'with-quote")

  assert.match(command, /CT_OPS_ORG_TOKEN='token'\\''with-quote'/)
  assert.equal(command.includes('token='), false)
})

test('buildAgentInstallScript only consumes CT_OPS_ORG_TOKEN from the runtime environment', () => {
  const script = buildAgentInstallScript('https://ct-ops.example.com', 'ct-ops.example.com:9443', false)

  assert.match(script, /if \[ -n "\$\{CT_OPS_ORG_TOKEN:-\}" \]; then/)
  assert.match(script, /sudo env CT_OPS_ORG_TOKEN="\$CT_OPS_ORG_TOKEN" \.\/ct-ops-agent --install --address "ct-ops\.example\.com:9443"/)
  assert.equal(script.includes('token='), false)
})
