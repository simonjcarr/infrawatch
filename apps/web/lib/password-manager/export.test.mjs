import test from 'node:test'
import assert from 'node:assert/strict'

import JSZip from 'jszip'

import {
  createPasswordManagerEncryptedVaultExportBundle,
  createPasswordManagerVaultExportBundle,
} from './export.ts'

const vaultExportInput = {
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
}

const sshVaultExportInput = {
  ...vaultExportInput,
  entries: [
    {
      id: 'entry-ssh',
      vaultId: 'vault-1',
      payload: {
        title: 'Production deploy SSH key',
        type: 'ssh-key-pair',
        username: 'SSH key pair',
        notes: 'Used by CI deploys',
        fields: {
          publicMaterial: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeployPublicKey deploy@example',
          privateKey: 'fixture SSH private key material',
        },
      },
      keyEpoch: 3,
      updatedAt: '2026-05-06T09:12:00Z',
    },
  ],
}

test('createPasswordManagerEncryptedVaultExportBundle packages encrypted vault data in a zip by default', async () => {
  const bundle = await createPasswordManagerEncryptedVaultExportBundle({
    ...vaultExportInput,
    exportPassword: 'EncryptedExportPassword!42',
  })

  assert.equal(bundle.fileName, 'shared-production-2026-05-06T09-15-00Z.password-manager.zip')
  assert.equal(bundle.mediaType, 'application/zip')

  const zip = await JSZip.loadAsync(await bundle.blob.arrayBuffer())
  const manifestFile = zip.file('manifest.json')
  const encryptedExportFile = zip.file('vault-export.encrypted.json')

  assert.ok(manifestFile)
  assert.ok(encryptedExportFile)

  const manifest = JSON.parse(await manifestFile.async('text'))
  const encryptedExport = JSON.parse(await encryptedExportFile.async('text'))

  assert.deepEqual(manifest, {
    format: 'ct-ops-password-manager-export',
    version: 1,
    encrypted: true,
    exported_at: '2026-05-06T09:15:00Z',
    vault_name: 'Shared Production',
    contents: ['vault-export.encrypted.json'],
  })
  assert.equal(encryptedExport.algorithm, 'pbkdf2-sha256+aes-256-gcm')
  assert.equal(encryptedExport.version, 1)
  assert.equal(encryptedExport.kdf.iterations, 600000)
  assert.equal(typeof encryptedExport.kdf.salt_b64, 'string')
  assert.equal(typeof encryptedExport.iv_b64, 'string')
  assert.equal(typeof encryptedExport.ciphertext_b64, 'string')

  const zipText = await bundle.blob.text()
  assert.doesNotMatch(zipText, /super-secret/)
  assert.doesNotMatch(zipText, /Rotate quarterly/)
})

test('createPasswordManagerVaultExportBundle packages decrypted vault data for explicit plaintext download only', async () => {
  const bundle = createPasswordManagerVaultExportBundle({
    ...vaultExportInput,
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
        type: 'login',
        title: 'Grafana',
        username: 'admin',
        password: 'super-secret',
        url: 'https://grafana.example.test',
        notes: 'Rotate quarterly',
        fields: null,
        key_epoch: 3,
        updated_at: '2026-05-06T09:10:00Z',
      },
    ],
  })
})

test('createPasswordManagerVaultExportBundle includes SSH key pair fields in explicit plaintext export', async () => {
  const bundle = createPasswordManagerVaultExportBundle({
    ...sshVaultExportInput,
  })

  const payload = JSON.parse(await bundle.blob.text())
  assert.deepEqual(payload.entries, [
    {
      id: 'entry-ssh',
      type: 'ssh-key-pair',
      title: 'Production deploy SSH key',
      username: 'SSH key pair',
      password: null,
      url: null,
      notes: 'Used by CI deploys',
      fields: {
        publicMaterial: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeployPublicKey deploy@example',
        privateKey: 'fixture SSH private key material',
      },
      key_epoch: 3,
      updated_at: '2026-05-06T09:12:00Z',
    },
  ])
})
