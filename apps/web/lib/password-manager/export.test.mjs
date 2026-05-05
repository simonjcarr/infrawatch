import test from 'node:test'
import assert from 'node:assert/strict'

import { createPasswordManagerVaultExportBundle } from './export.ts'

test('createPasswordManagerVaultExportBundle packages decrypted vault data for local download only', async () => {
  const bundle = createPasswordManagerVaultExportBundle({
    vault: {
      id: 'vault-1',
      metadata: { name: 'Shared Production', description: 'Critical systems' },
      currentKeyEpoch: 3,
      role: 'owner',
      updatedAt: '2026-05-06T09:00:00Z',
      wrappedVaultKeyEnvelope: { wrapped_key_b64: 'opaque' },
    },
    entries: [
      {
        id: 'entry-1',
        vaultId: 'vault-1',
        payload: {
          title: 'Grafana',
          username: 'admin',
          password: 'super-secret',
          url: 'https://grafana.example.test',
          notes: 'Rotate quarterly',
        },
        keyEpoch: 3,
        updatedAt: '2026-05-06T09:10:00Z',
      },
    ],
    exportedAt: '2026-05-06T09:15:00Z',
  })

  assert.equal(bundle.fileName, 'shared-production-2026-05-06T09-15-00Z.password-manager.json')
  assert.equal(bundle.mediaType, 'application/json')

  const payload = JSON.parse(await bundle.blob.text())
  assert.deepEqual(payload, {
    exported_at: '2026-05-06T09:15:00Z',
    vault: {
      id: 'vault-1',
      name: 'Shared Production',
      description: 'Critical systems',
      role: 'owner',
      current_key_epoch: 3,
      updated_at: '2026-05-06T09:00:00Z',
    },
    entries: [
      {
        id: 'entry-1',
        title: 'Grafana',
        username: 'admin',
        password: 'super-secret',
        url: 'https://grafana.example.test',
        notes: 'Rotate quarterly',
        key_epoch: 3,
        updated_at: '2026-05-06T09:10:00Z',
      },
    ],
  })
})
