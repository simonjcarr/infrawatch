import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT_LENGTH = 16
const IV_LENGTH = 16
const TAG_LENGTH = 16

// Version byte prefixed to every new-format blob.
// v1 = per-record random salt + LDAP_ENCRYPTION_KEY (or BETTER_AUTH_SECRET fallback).
const VERSION_V1 = 0x01

// Legacy constants — only used when decrypting values written before v1 was introduced.
// The hardcoded salt was the security flaw fixed by v1: a single compromised secret
// decrypted every stored credential across all organisations.
const LEGACY_SALT = 'infrawatch-ldap-encryption-salt'

function deriveKey(salt: Buffer): Buffer {
  // Prefer a dedicated LDAP encryption key so rotating auth secrets doesn't
  // silently break stored LDAP credentials (H-04).
  const secret = process.env['LDAP_ENCRYPTION_KEY'] ?? process.env['BETTER_AUTH_SECRET']
  if (!secret) throw new Error('LDAP_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) must be set')
  return scryptSync(secret, salt, 32)
}

// New format (v1): base64( VERSION(1) || salt(16) || iv(16) || tag(16) || ciphertext )
// Per-record random salt means two encryptions of the same value produce different blobs (H-03).
export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(salt)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([Buffer.from([VERSION_V1]), salt, iv, tag, encrypted]).toString('base64')
}

export function decrypt(ciphertext: string): string {
  // Legacy format: three colon-separated hex chunks (iv:tag:ciphertext).
  // Base64 never contains colons, so this check is unambiguous.
  if (ciphertext.includes(':')) {
    return decryptLegacy(ciphertext)
  }

  const blob = Buffer.from(ciphertext, 'base64')
  if (blob[0] !== VERSION_V1) throw new Error('Unknown encryption version')

  const salt = blob.subarray(1, 1 + SALT_LENGTH)
  const iv = blob.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH)
  const tag = blob.subarray(1 + SALT_LENGTH + IV_LENGTH, 1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const data = blob.subarray(1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  if (tag.length !== TAG_LENGTH) throw new Error(`Expected ${TAG_LENGTH}-byte GCM auth tag, got ${tag.length}`)
  const key = deriveKey(salt)
  const decipher = createDecipheriv(ALGORITHM, key, iv) // nosemgrep: javascript.node-crypto.security.gcm-no-tag-length.gcm-no-tag-length
  decipher.setAuthTag(tag)

  return decipher.update(data).toString('utf8') + decipher.final('utf8')
}

// Decrypts values written with the old single-KDF-key format.
// Always uses BETTER_AUTH_SECRET + hardcoded salt (the original implementation).
function decryptLegacy(encrypted: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 3) throw new Error('Invalid legacy encrypted format')

  const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string]
  const secret = process.env['BETTER_AUTH_SECRET']
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')

  const tag = Buffer.from(tagHex, 'hex')
  if (tag.length !== TAG_LENGTH) throw new Error(`Expected ${TAG_LENGTH}-byte GCM auth tag, got ${tag.length}`)
  const key = scryptSync(secret, LEGACY_SALT, 32)
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex')) // nosemgrep: javascript.node-crypto.security.gcm-no-tag-length.gcm-no-tag-length
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
