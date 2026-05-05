const PBKDF2_ITERATIONS = 600_000
const DERIVED_KEY_LENGTH = 32
const AES_GCM_IV_BYTES = 12
const PBKDF2_SALT_BYTES = 16

export interface PasswordManagerKdfMetadata {
  algorithm: 'pbkdf2-sha256'
  iterations: number
  salt_b64: string
  derived_key_length: number
}

export interface PasswordManagerPublicKeyEnvelope {
  version: 1
  algorithm: 'rsa-oaep-256'
  public_key_spki_b64: string
}

export interface PasswordManagerEncryptedPrivateKeyEnvelope
  extends PasswordManagerPublicKeyEnvelope {
  iv_b64: string
  ciphertext_b64: string
}

export interface PasswordManagerWrappedVaultKeyEnvelope {
  version: 1
  algorithm: 'rsa-oaep-256'
  wrapped_key_b64: string
}

export interface PasswordManagerEncryptedPayloadEnvelope {
  version: 1
  algorithm: 'aes-256-gcm'
  iv_b64: string
  ciphertext_b64: string
}

export interface PasswordManagerVaultMetadata {
  name: string
  description?: string
}

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required')
  }
  return globalThis.crypto
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(value: string): ArrayBuffer {
  const bytes = Buffer.from(value, 'base64')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
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

async function deriveAesKey(
  unlockPassword: string,
  metadata: PasswordManagerKdfMetadata,
): Promise<CryptoKey> {
  const crypto = getWebCrypto()
  const passwordMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(unlockPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(metadata.salt_b64),
      iterations: metadata.iterations,
    },
    passwordMaterial,
    {
      name: 'AES-GCM',
      length: metadata.derived_key_length * 8,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function createUnlockProfile(unlockPassword: string): Promise<{
  encryptedPrivateKeyEnvelope: PasswordManagerEncryptedPrivateKeyEnvelope
  kdfMetadata: PasswordManagerKdfMetadata
  publicKey: CryptoKey
}> {
  const crypto = getWebCrypto()
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['wrapKey', 'unwrapKey'],
  )
  const privateKeyBytes = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const publicKeyBytes = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const kdfMetadata: PasswordManagerKdfMetadata = {
    algorithm: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt_b64: toBase64(randomBytes(PBKDF2_SALT_BYTES)),
    derived_key_length: DERIVED_KEY_LENGTH,
  }
  const aesKey = await deriveAesKey(unlockPassword, kdfMetadata)
  const iv = randomBytes(AES_GCM_IV_BYTES)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    aesKey,
    privateKeyBytes,
  )

  return {
    encryptedPrivateKeyEnvelope: {
      version: 1,
      algorithm: 'rsa-oaep-256',
      public_key_spki_b64: toBase64(publicKeyBytes),
      iv_b64: toBase64(iv),
      ciphertext_b64: toBase64(ciphertext),
    },
    kdfMetadata,
    publicKey: keyPair.publicKey,
  }
}

export async function decryptUserPrivateKeyEnvelope(input: {
  unlockPassword: string
  encryptedPrivateKeyEnvelope: PasswordManagerEncryptedPrivateKeyEnvelope
  kdfMetadata: PasswordManagerKdfMetadata
}): Promise<{
  privateKey: CryptoKey
  publicKey: CryptoKey
}> {
  const crypto = getWebCrypto()
  const aesKey = await deriveAesKey(input.unlockPassword, input.kdfMetadata)
  const privateKeyBytes = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(input.encryptedPrivateKeyEnvelope.iv_b64),
    },
    aesKey,
    fromBase64(input.encryptedPrivateKeyEnvelope.ciphertext_b64),
  )

  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      true,
      ['unwrapKey'],
    ),
    crypto.subtle.importKey(
      'spki',
      fromBase64(input.encryptedPrivateKeyEnvelope.public_key_spki_b64),
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      true,
      ['wrapKey'],
    ),
  ])

  return { privateKey, publicKey }
}

export async function exportPublicKeyEnvelope(
  publicKey: CryptoKey,
): Promise<PasswordManagerPublicKeyEnvelope> {
  const publicKeyBytes = await getWebCrypto().subtle.exportKey('spki', publicKey)
  return {
    version: 1,
    algorithm: 'rsa-oaep-256',
    public_key_spki_b64: toBase64(publicKeyBytes),
  }
}

export async function generateVaultKey(): Promise<CryptoKey> {
  return getWebCrypto().subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function wrapVaultKeyForMember(
  vaultKey: CryptoKey,
  memberPublicKey: CryptoKey,
): Promise<PasswordManagerWrappedVaultKeyEnvelope> {
  const wrappedKey = await getWebCrypto().subtle.wrapKey(
    'raw',
    vaultKey,
    memberPublicKey,
    {
      name: 'RSA-OAEP',
    },
  )

  return {
    version: 1,
    algorithm: 'rsa-oaep-256',
    wrapped_key_b64: toBase64(wrappedKey),
  }
}

export async function unwrapVaultKeyEnvelope(
  wrappedVaultKeyEnvelope: PasswordManagerWrappedVaultKeyEnvelope,
  memberPrivateKey: CryptoKey,
): Promise<CryptoKey> {
  return getWebCrypto().subtle.unwrapKey(
    'raw',
    fromBase64(wrappedVaultKeyEnvelope.wrapped_key_b64),
    memberPrivateKey,
    {
      name: 'RSA-OAEP',
    },
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function createEncryptedEntryPayload(
  value: unknown,
  vaultKey: CryptoKey,
): Promise<PasswordManagerEncryptedPayloadEnvelope> {
  return createEncryptedJsonEnvelope(value, vaultKey)
}

export async function createEncryptedVaultMetadata(
  value: PasswordManagerVaultMetadata,
  vaultKey: CryptoKey,
): Promise<PasswordManagerEncryptedPayloadEnvelope> {
  return createEncryptedJsonEnvelope(value, vaultKey)
}

async function createEncryptedJsonEnvelope(
  value: unknown,
  vaultKey: CryptoKey,
): Promise<PasswordManagerEncryptedPayloadEnvelope> {
  const iv = randomBytes(AES_GCM_IV_BYTES)
  const ciphertext = await getWebCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    vaultKey,
    new TextEncoder().encode(JSON.stringify(value)),
  )

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv_b64: toBase64(iv),
    ciphertext_b64: toBase64(ciphertext),
  }
}

export async function decryptEntryPayload<T>(
  envelope: PasswordManagerEncryptedPayloadEnvelope,
  vaultKey: CryptoKey,
): Promise<T> {
  return decryptJsonEnvelope<T>(envelope, vaultKey)
}

export async function decryptVaultMetadata(
  envelope: PasswordManagerEncryptedPayloadEnvelope,
  vaultKey: CryptoKey,
): Promise<PasswordManagerVaultMetadata> {
  return decryptJsonEnvelope<PasswordManagerVaultMetadata>(envelope, vaultKey)
}

async function decryptJsonEnvelope<T>(
  envelope: PasswordManagerEncryptedPayloadEnvelope,
  vaultKey: CryptoKey,
): Promise<T> {
  const plaintext = await getWebCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv_b64),
    },
    vaultKey,
    fromBase64(envelope.ciphertext_b64),
  )

  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}
