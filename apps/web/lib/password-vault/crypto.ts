const PASSWORD_VAULT_KDF_VERSION = 1
const PASSWORD_VAULT_PAYLOAD_ENVELOPE_VERSION = 1
const PASSWORD_VAULT_PRIVATE_KEY_ENVELOPE_VERSION = 1
const PASSWORD_VAULT_WRAPPED_KEY_VERSION = 1
const PASSWORD_VAULT_AES_KEY_LENGTH = 32
const PASSWORD_VAULT_GCM_IV_LENGTH = 12
const PASSWORD_VAULT_HKDF_SALT_LENGTH = 16
const PASSWORD_VAULT_PBKDF_SALT_LENGTH = 16
const PASSWORD_VAULT_SHARED_KEY_CURVE = 'P-256'
const PASSWORD_VAULT_SHARED_KEY_DERIVE_BITS = 256
const PASSWORD_VAULT_PAYLOAD_AAD = 'ctops-password-vault-payload:v1'
const PASSWORD_VAULT_PRIVATE_KEY_AAD = 'ctops-password-vault-private-key:v1'
const PASSWORD_VAULT_WRAPPED_KEY_AAD = 'ctops-password-vault-wrap:v1'
const PASSWORD_VAULT_HKDF_INFO = 'ctops-password-vault-wrap-key:v1'

export type PasswordVaultKdfParams = {
  version: number
  algorithm: 'argon2id'
  memoryKiB: number
  iterations: number
  parallelism: number
  keyLength: number
  salt: string
}

export type PasswordVaultAeadEnvelope = {
  version: number
  algorithm: 'AES-256-GCM'
  iv: string
  ciphertext: string
}

export type WrappedPasswordVaultKeyEnvelope = PasswordVaultAeadEnvelope & {
  wrapVersion: number
  salt: string
}

export const DEFAULT_PASSWORD_VAULT_KDF_PARAMS: Omit<PasswordVaultKdfParams, 'salt'> = {
  version: PASSWORD_VAULT_KDF_VERSION,
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
  keyLength: PASSWORD_VAULT_AES_KEY_LENGTH,
}

type SodiumApi = typeof import('libsodium-wrappers-sumo')

let sodiumPromise: Promise<SodiumApi> | undefined

async function getSodium() {
  sodiumPromise ??= import('libsodium-wrappers-sumo').then(async (module) => {
    const sodium = ('default' in module ? module.default : module) as SodiumApi
    await sodium.ready
    return sodium
  })

  return sodiumPromise
}

function toBase64Url(bytes: Uint8Array): string {
  let encoded = ''

  for (const byte of bytes) {
    encoded += String.fromCharCode(byte)
  }

  return btoa(encoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padding = (4 - (value.length % 4 || 4)) % 4
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding)
  const decoded = atob(normalised)
  const bytes = new Uint8Array(decoded.length)

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }

  return bytes
}

function createRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function getEnvelopeAad(label: string): Uint8Array {
  return encodeUtf8(label)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

async function importAesKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, usages)
}

async function derivePasswordVaultUnlockKeyBytes(
  password: string,
  params: PasswordVaultKdfParams,
): Promise<Uint8Array> {
  const sodium = await getSodium()
  const salt = encodeUtf8(params.salt)

  if (salt.byteLength < PASSWORD_VAULT_PBKDF_SALT_LENGTH) {
    throw new Error('Password Vault KDF salt is too short')
  }

  if (params.memoryKiB < DEFAULT_PASSWORD_VAULT_KDF_PARAMS.memoryKiB) {
    throw new Error('Password Vault Argon2id memory must not fall below the MVP floor')
  }

  if (params.iterations < DEFAULT_PASSWORD_VAULT_KDF_PARAMS.iterations) {
    throw new Error('Password Vault Argon2id iterations must not fall below the MVP floor')
  }

  if (params.parallelism < DEFAULT_PASSWORD_VAULT_KDF_PARAMS.parallelism) {
    throw new Error('Password Vault Argon2id parallelism must not fall below the MVP floor')
  }

  return sodium.crypto_pwhash(
    params.keyLength,
    password,
    salt.subarray(0, PASSWORD_VAULT_PBKDF_SALT_LENGTH),
    params.iterations,
    params.memoryKiB * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
    'uint8array',
  )
}

async function encryptBytes(
  key: CryptoKey,
  payload: Uint8Array,
  aad: string,
): Promise<PasswordVaultAeadEnvelope> {
  const iv = createRandomBytes(PASSWORD_VAULT_GCM_IV_LENGTH)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(getEnvelopeAad(aad)),
    },
    key,
    toArrayBuffer(payload),
  )

  return {
    version: PASSWORD_VAULT_PAYLOAD_ENVELOPE_VERSION,
    algorithm: 'AES-256-GCM',
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

async function decryptBytes(
  key: CryptoKey,
  envelope: PasswordVaultAeadEnvelope,
  aad: string,
): Promise<Uint8Array> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(fromBase64Url(envelope.iv)),
        additionalData: toArrayBuffer(getEnvelopeAad(aad)),
      },
      key,
      toArrayBuffer(fromBase64Url(envelope.ciphertext)),
    )

    return new Uint8Array(plaintext)
  } catch {
    throw new Error('Password Vault envelope decryption failed')
  }
}

async function exportRawKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key))
}

async function deriveWrappingKey(params: {
  privateKey: CryptoKey
  publicKey: CryptoKey
  salt: Uint8Array
}): Promise<CryptoKey> {
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: params.publicKey,
    },
    params.privateKey,
    PASSWORD_VAULT_SHARED_KEY_DERIVE_BITS,
  )
  const hkdfBaseKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(params.salt),
      info: toArrayBuffer(encodeUtf8(PASSWORD_VAULT_HKDF_INFO)),
    },
    hkdfBaseKey,
    {
      name: 'AES-GCM',
      length: PASSWORD_VAULT_AES_KEY_LENGTH * 8,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function createPasswordVaultKdfParams(salt = toBase64Url(createRandomBytes(PASSWORD_VAULT_PBKDF_SALT_LENGTH))): PasswordVaultKdfParams {
  return {
    ...DEFAULT_PASSWORD_VAULT_KDF_PARAMS,
    salt,
  }
}

export function serialisePasswordVaultKdfParams(params: PasswordVaultKdfParams): string {
  return JSON.stringify(params)
}

export async function derivePasswordVaultUnlockKey(
  password: string,
  params: PasswordVaultKdfParams,
): Promise<string> {
  return toBase64Url(await derivePasswordVaultUnlockKeyBytes(password, params))
}

export async function generatePasswordVaultSharingKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: PASSWORD_VAULT_SHARED_KEY_CURVE,
    },
    true,
    ['deriveBits'],
  )
}

export async function createUserPrivateKeyEnvelope(password: string): Promise<{
  publicKey: string
  kdfParams: PasswordVaultKdfParams
  privateKeyEnvelope: PasswordVaultAeadEnvelope
  decryptPrivateKey: (unlockPassword: string) => Promise<CryptoKey>
}> {
  const keyPair = await generatePasswordVaultSharingKeyPair()
  const privateKeyBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
  const kdfParams = createPasswordVaultKdfParams()
  const unlockKeyBytes = await derivePasswordVaultUnlockKeyBytes(password, kdfParams)
  const unlockKey = await importAesKey(unlockKeyBytes, ['encrypt', 'decrypt'])
  const privateKeyEnvelope = await encryptBytes(
    unlockKey,
    privateKeyBytes,
    PASSWORD_VAULT_PRIVATE_KEY_AAD,
  )

  return {
    publicKey: toBase64Url(publicKeyBytes),
    kdfParams,
    privateKeyEnvelope: {
      ...privateKeyEnvelope,
      version: PASSWORD_VAULT_PRIVATE_KEY_ENVELOPE_VERSION,
    },
    decryptPrivateKey: async (unlockPassword: string) => {
      const candidateKeyBytes = await derivePasswordVaultUnlockKeyBytes(unlockPassword, kdfParams)
      const candidateKey = await importAesKey(candidateKeyBytes, ['decrypt'])

      try {
        const decrypted = await decryptBytes(
          candidateKey,
          privateKeyEnvelope,
          PASSWORD_VAULT_PRIVATE_KEY_AAD,
        )

        return crypto.subtle.importKey(
          'pkcs8',
          toArrayBuffer(decrypted),
          {
            name: 'ECDH',
            namedCurve: PASSWORD_VAULT_SHARED_KEY_CURVE,
          },
          true,
          ['deriveBits'],
        )
      } catch {
        throw new Error('Password Vault unlock failed')
      }
    },
  }
}

export async function generatePasswordVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: PASSWORD_VAULT_AES_KEY_LENGTH * 8,
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptVaultPayload(
  vaultKey: CryptoKey,
  payload: unknown,
): Promise<PasswordVaultAeadEnvelope> {
  return encryptBytes(vaultKey, encodeUtf8(JSON.stringify(payload)), PASSWORD_VAULT_PAYLOAD_AAD)
}

export async function decryptVaultPayload<T>(
  vaultKey: CryptoKey,
  envelope: PasswordVaultAeadEnvelope,
): Promise<T> {
  return JSON.parse(
    decodeUtf8(await decryptBytes(vaultKey, envelope, PASSWORD_VAULT_PAYLOAD_AAD)),
  ) as T
}

export async function wrapPasswordVaultKey(params: {
  vaultKey: CryptoKey
  senderPrivateKey: CryptoKey
  recipientPublicKey: CryptoKey
}): Promise<WrappedPasswordVaultKeyEnvelope> {
  const salt = createRandomBytes(PASSWORD_VAULT_HKDF_SALT_LENGTH)
  const wrappingKey = await deriveWrappingKey({
    privateKey: params.senderPrivateKey,
    publicKey: params.recipientPublicKey,
    salt,
  })
  const wrapped = await encryptBytes(
    wrappingKey,
    await exportRawKey(params.vaultKey),
    PASSWORD_VAULT_WRAPPED_KEY_AAD,
  )

  return {
    ...wrapped,
    wrapVersion: PASSWORD_VAULT_WRAPPED_KEY_VERSION,
    salt: toBase64Url(salt),
  }
}

export async function unwrapPasswordVaultKey(params: {
  wrappedVaultKey: WrappedPasswordVaultKeyEnvelope
  recipientPrivateKey: CryptoKey
  senderPublicKey: CryptoKey
}): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey({
    privateKey: params.recipientPrivateKey,
    publicKey: params.senderPublicKey,
    salt: fromBase64Url(params.wrappedVaultKey.salt),
  })
  const rawVaultKey = await decryptBytes(
    wrappingKey,
    params.wrappedVaultKey,
    PASSWORD_VAULT_WRAPPED_KEY_AAD,
  )

  return importAesKey(rawVaultKey, ['encrypt', 'decrypt'])
}
