import { pbkdf as bcryptPbkdf } from 'bcrypt-pbkdf'

const SSH_KEY_AUTH_MAGIC = 'openssh-key-v1\0'
const SSH_KEY_COMMENT_FALLBACK = 'ct-ops-password-manager'
const SSH_KEY_BCRYPT_ROUNDS = 16
const SSH_KEY_AES_KEY_BYTES = 32
const SSH_KEY_AES_IV_BYTES = 16
const SSH_KEY_AES_BLOCK_BYTES = 16
const SSH_KEY_NONE_BLOCK_BYTES = 8
const SSH_KEY_RSA_MODULUS_BITS = 4096

export type PasswordManagerSshKeyAlgorithm = 'ed25519' | 'rsa'

export interface PasswordManagerGeneratedSshKeyPair {
  algorithm: PasswordManagerSshKeyAlgorithm
  publicMaterial: string
  privateKey: string
}

export interface GeneratePasswordManagerSshKeyPairInput {
  algorithm: PasswordManagerSshKeyAlgorithm
  comment?: string
  passphrase?: string
}

type RsaPrivateParts = {
  n: Uint8Array
  e: Uint8Array
  d: Uint8Array
  p: Uint8Array
  q: Uint8Array
  qi: Uint8Array
}

type SshKeyParts = {
  publicKey: Uint8Array
  privateKey: Uint8Array
  publicMaterial: string
}

export async function generatePasswordManagerSshKeyPair(
  input: GeneratePasswordManagerSshKeyPairInput,
): Promise<PasswordManagerGeneratedSshKeyPair> {
  const comment = normalizeSshKeyComment(input.comment)
  const parts =
    input.algorithm === 'rsa'
      ? await generateRsaSshKeyParts(comment)
      : await generateEd25519SshKeyParts(comment)

  return {
    algorithm: input.algorithm,
    publicMaterial: parts.publicMaterial,
    privateKey: await encodeOpenSshPrivateKey({
      publicKey: parts.publicKey,
      privateKey: parts.privateKey,
      comment,
      passphrase: input.passphrase,
    }),
  }
}

async function generateEd25519SshKeyParts(comment: string): Promise<SshKeyParts> {
  const keyPair = await getWebCrypto().subtle.generateKey(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const publicKeyBytes = new Uint8Array(await getWebCrypto().subtle.exportKey('raw', keyPair.publicKey))
  const privateKeyBytes = new Uint8Array(await getWebCrypto().subtle.exportKey('pkcs8', keyPair.privateKey))
  const seed = privateKeyBytes.slice(privateKeyBytes.byteLength - 32)
  const publicKey = concatBytes(sshString('ssh-ed25519'), sshString(publicKeyBytes))
  const privateKey = concatBytes(
    sshString('ssh-ed25519'),
    sshString(publicKeyBytes),
    sshString(concatBytes(seed, publicKeyBytes)),
  )

  return {
    publicKey,
    privateKey,
    publicMaterial: `ssh-ed25519 ${toBase64(publicKey)} ${comment}`,
  }
}

async function generateRsaSshKeyParts(comment: string): Promise<SshKeyParts> {
  const keyPair = await getWebCrypto().subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      modulusLength: SSH_KEY_RSA_MODULUS_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = await getWebCrypto().subtle.exportKey('jwk', keyPair.privateKey)
  const parts = parseRsaPrivateParts(jwk)
  const publicKey = concatBytes(sshString('ssh-rsa'), sshMpint(parts.e), sshMpint(parts.n))
  const privateKey = concatBytes(
    sshString('ssh-rsa'),
    sshMpint(parts.n),
    sshMpint(parts.e),
    sshMpint(parts.d),
    sshMpint(parts.qi),
    sshMpint(parts.p),
    sshMpint(parts.q),
  )

  return {
    publicKey,
    privateKey,
    publicMaterial: `ssh-rsa ${toBase64(publicKey)} ${comment}`,
  }
}

async function encodeOpenSshPrivateKey(input: {
  publicKey: Uint8Array
  privateKey: Uint8Array
  comment: string
  passphrase?: string
}): Promise<string> {
  const checkBytes = randomBytes(4)
  const privateBlob = padOpenSshPrivateBlob(
    concatBytes(
      checkBytes,
      checkBytes,
      input.privateKey,
      sshString(input.comment),
    ),
    input.passphrase?.trim() ? SSH_KEY_AES_BLOCK_BYTES : SSH_KEY_NONE_BLOCK_BYTES,
  )

  let cipherName = 'none'
  let kdfName = 'none'
  let kdfOptions: Uint8Array<ArrayBufferLike> = new Uint8Array()
  let privatePayload: Uint8Array<ArrayBufferLike> = privateBlob

  if (input.passphrase?.trim()) {
    cipherName = 'aes256-ctr'
    kdfName = 'bcrypt'
    const salt = randomBytes(16)
    const keyMaterial = deriveOpenSshKeyMaterial(input.passphrase, salt)
    const aesKey = keyMaterial.slice(0, SSH_KEY_AES_KEY_BYTES)
    const aesIv = keyMaterial.slice(SSH_KEY_AES_KEY_BYTES, SSH_KEY_AES_KEY_BYTES + SSH_KEY_AES_IV_BYTES)
    privatePayload = new Uint8Array(
      await getWebCrypto().subtle.encrypt(
        {
          name: 'AES-CTR',
          counter: toArrayBuffer(aesIv),
          length: 128,
        },
        await getWebCrypto().subtle.importKey('raw', toArrayBuffer(aesKey), 'AES-CTR', false, ['encrypt']),
        toArrayBuffer(privateBlob),
      ),
    )
    kdfOptions = concatBytes(sshString(salt), uint32(SSH_KEY_BCRYPT_ROUNDS))
  }

  const opensshKey = concatBytes(
    new TextEncoder().encode(SSH_KEY_AUTH_MAGIC),
    sshString(cipherName),
    sshString(kdfName),
    sshString(kdfOptions),
    uint32(1),
    sshString(input.publicKey),
    sshString(privatePayload),
  )

  return wrapPem('OPENSSH PRIVATE KEY', toBase64(opensshKey))
}

function deriveOpenSshKeyMaterial(passphrase: string, salt: Uint8Array): Uint8Array {
  const keyMaterial = new Uint8Array(SSH_KEY_AES_KEY_BYTES + SSH_KEY_AES_IV_BYTES)
  const passphraseBytes = new TextEncoder().encode(passphrase)
  bcryptPbkdf(
    passphraseBytes,
    passphraseBytes.byteLength,
    salt,
    salt.byteLength,
    keyMaterial,
    keyMaterial.byteLength,
    SSH_KEY_BCRYPT_ROUNDS,
  )
  return keyMaterial
}

function parseRsaPrivateParts(jwk: JsonWebKey): RsaPrivateParts {
  const requiredFields = ['n', 'e', 'd', 'p', 'q', 'qi'] as const
  for (const field of requiredFields) {
    if (!jwk[field]) {
      throw new Error(`Generated RSA key is missing ${field}`)
    }
  }

  return {
    n: fromBase64Url(jwk.n!),
    e: fromBase64Url(jwk.e!),
    d: fromBase64Url(jwk.d!),
    p: fromBase64Url(jwk.p!),
    q: fromBase64Url(jwk.q!),
    qi: fromBase64Url(jwk.qi!),
  }
}

function padOpenSshPrivateBlob(input: Uint8Array, blockBytes: number): Uint8Array {
  const paddingLength = blockBytes - (input.byteLength % blockBytes || blockBytes)
  if (paddingLength === 0) {
    return input
  }
  const padding = new Uint8Array(paddingLength)
  for (let index = 0; index < padding.length; index += 1) {
    padding[index] = index + 1
  }
  return concatBytes(input, padding)
}

function normalizeSshKeyComment(comment: string | undefined): string {
  return (comment?.trim() || SSH_KEY_COMMENT_FALLBACK).replace(/\s+/g, '-')
}

function sshString(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return concatBytes(uint32(bytes.byteLength), bytes)
}

function sshMpint(value: Uint8Array): Uint8Array {
  let firstNonZero = 0
  while (firstNonZero < value.byteLength - 1 && value[firstNonZero] === 0) {
    firstNonZero += 1
  }
  const trimmed = value.slice(firstNonZero)
  const needsSignPadding = (trimmed[0] ?? 0) >= 0x80
  return sshString(needsSignPadding ? concatBytes(new Uint8Array([0]), trimmed) : trimmed)
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
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

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return fromBase64(base64)
}

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function toBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64')
  }

  let binary = ''
  for (let index = 0; index < value.byteLength; index += 1) {
    binary += String.fromCharCode(value[index]!)
  }
  return btoa(binary)
}

function wrapPem(label: string, base64: string): string {
  const lines = base64.match(/.{1,70}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required')
  }
  return globalThis.crypto
}
