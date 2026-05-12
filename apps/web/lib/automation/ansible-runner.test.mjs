import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAnsibleInventoryHost,
  redactAnsibleOutput,
  validateSshPrivateKey,
} from './ansible-runner.ts'

function privateKeyBlock(kind = 'OPENSSH') {
  return [
    `${'-'.repeat(5)}BEGIN ${kind} PRIVATE KEY${'-'.repeat(5)}`,
    'fixture-key-body',
    `${'-'.repeat(5)}END ${kind} PRIVATE KEY${'-'.repeat(5)}`,
  ].join('\n')
}

test('redactAnsibleOutput removes private key material and common password fields', () => {
  const output = [
    'ok: [server-1]',
    privateKeyBlock(),
    'ansible_password=super-secret',
    '"password": "another-secret"',
  ].join('\n')

  const redacted = redactAnsibleOutput(output)

  assert.match(redacted, /ok: \[server-1\]/)
  assert.doesNotMatch(redacted, /secret-key-body/)
  assert.doesNotMatch(redacted, /super-secret/)
  assert.doesNotMatch(redacted, /another-secret/)
  assert.match(redacted, /\[REDACTED PRIVATE KEY\]/)
  assert.match(redacted, /ansible_password=\[REDACTED\]/)
})

test('validateSshPrivateKey accepts PEM and OpenSSH private key blocks only', () => {
  assert.equal(validateSshPrivateKey(privateKeyBlock()), true)
  assert.equal(validateSshPrivateKey(privateKeyBlock('RSA')), true)
  assert.equal(validateSshPrivateKey('ssh-rsa AAAAB3Nza...'), false)
  assert.equal(validateSshPrivateKey('not a key'), false)
})

test('buildAnsibleInventoryHost prefers the first IP and falls back to hostname', () => {
  assert.deepEqual(
    buildAnsibleInventoryHost({
      id: 'host_1',
      hostname: 'server-1.local',
      displayName: 'Server 1',
      ipAddresses: ['10.0.0.5', '10.0.0.6'],
    }, 2222),
    {
      id: 'host_1',
      name: 'server-1.local',
      address: '10.0.0.5',
      port: 2222,
    },
  )

  assert.deepEqual(
    buildAnsibleInventoryHost({
      id: 'host_2',
      hostname: 'server-2.local',
      displayName: null,
      ipAddresses: [],
    }),
    {
      id: 'host_2',
      name: 'server-2.local',
      address: 'server-2.local',
      port: 22,
    },
  )
})
