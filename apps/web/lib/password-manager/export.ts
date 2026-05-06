import type {
  PasswordManagerEntrySummary,
  PasswordManagerVaultSummary,
} from './workspace.ts'
import JSZip from 'jszip'

const EXPORT_KDF_ITERATIONS = 600_000
const EXPORT_DERIVED_KEY_LENGTH = 32
const EXPORT_SALT_BYTES = 16
const EXPORT_IV_BYTES = 12

export interface PasswordManagerVaultExportBundle {
  blob: Blob
  fileName: string
  mediaType: 'application/json' | 'application/zip'
}

export interface PasswordManagerVaultExportInput {
  vault: PasswordManagerVaultSummary
  entries: PasswordManagerEntrySummary[]
  exportedAt?: string
}

export async function createPasswordManagerEncryptedVaultExportBundle(
  input: PasswordManagerVaultExportInput & { exportPassword: string },
): Promise<PasswordManagerVaultExportBundle> {
  if (!input.exportPassword.trim()) {
    throw new Error('Choose an export password before creating an encrypted vault export.')
  }

  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const payload = createPasswordManagerVaultExportPayload({ ...input, exportedAt })
  const encryptedPayload = await encryptVaultExportPayload(payload, input.exportPassword)
  const zip = new JSZip()

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format: 'ct-ops-password-manager-export',
        version: 1,
        encrypted: true,
        exported_at: exportedAt,
        vault_name: input.vault.metadata.name,
        contents: ['vault-export.encrypted.json'],
      },
      null,
      2,
    ),
  )
  zip.file('vault-export.encrypted.json', JSON.stringify(encryptedPayload, null, 2))

  return {
    blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }),
    fileName: `${slugifyFileStem(input.vault.metadata.name)}-${exportedAt.replaceAll(':', '-')}.password-manager.zip`,
    mediaType: 'application/zip',
  }
}

export function createPasswordManagerVaultExportBundle(
  input: PasswordManagerVaultExportInput,
): PasswordManagerVaultExportBundle {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const payload = createPasswordManagerVaultExportPayload({ ...input, exportedAt })
  const fileName = `${slugifyFileStem(input.vault.metadata.name)}-${exportedAt.replaceAll(':', '-')}.password-manager.json`

  return {
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    fileName,
    mediaType: 'application/json',
  }
}

function createPasswordManagerVaultExportPayload(input: PasswordManagerVaultExportInput & { exportedAt: string }) {
  return {
    exported_at: input.exportedAt,
    vault: {
      id: input.vault.id,
      name: input.vault.metadata.name,
      description: input.vault.metadata.description ?? null,
      role: input.vault.role,
      current_key_epoch: input.vault.currentKeyEpoch,
      updated_at: input.vault.updatedAt,
    },
    entries: input.entries.map((entry) => ({
      id: entry.id,
      type: entry.payload.type ?? 'login',
      title: entry.payload.title,
      username: entry.payload.username ?? null,
      password: entry.payload.password ?? null,
      url: entry.payload.url ?? null,
      notes: entry.payload.notes ?? null,
      fields: entry.payload.fields ?? null,
      key_epoch: entry.keyEpoch,
      updated_at: entry.updatedAt,
    })),
  }
}

async function encryptVaultExportPayload(payload: unknown, exportPassword: string) {
  const crypto = getWebCrypto()
  const salt = randomBytes(EXPORT_SALT_BYTES)
  const iv = randomBytes(EXPORT_IV_BYTES)
  const passwordMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(exportPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const exportKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations: EXPORT_KDF_ITERATIONS,
    },
    passwordMaterial,
    {
      name: 'AES-GCM',
      length: EXPORT_DERIVED_KEY_LENGTH * 8,
    },
    false,
    ['encrypt'],
  )
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    exportKey,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(payload))),
  )

  return {
    version: 1,
    algorithm: 'pbkdf2-sha256+aes-256-gcm',
    kdf: {
      algorithm: 'pbkdf2-sha256',
      iterations: EXPORT_KDF_ITERATIONS,
      salt_b64: toBase64(salt),
      derived_key_length: EXPORT_DERIVED_KEY_LENGTH,
    },
    iv_b64: toBase64(iv),
    ciphertext_b64: toBase64(ciphertext),
  }
}

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required')
  }
  return globalThis.crypto
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(new ArrayBuffer(length))
  getWebCrypto().getRandomValues(bytes)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return arrayBuffer
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!)
  }
  return btoa(binary)
}

function slugifyFileStem(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'password-manager-vault'
}
