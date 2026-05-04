import { makeSignature, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { createHmac } from 'node:crypto'

export const LDAP_TWO_FACTOR_COOKIE_NAME = 'ct-ops.ldap_2fa'
export const LDAP_TWO_FACTOR_CHALLENGE_TTL_MS = 10 * 60 * 1000

export type LdapTwoFactorMethod = 'totp' | 'backup_code'

export interface LdapTwoFactorChallenge {
  userId: string
  username: string
}

export interface LdapTwoFactorCredential {
  secret: string
  backupCodes: string | null
}

export interface VerifiedBackupCode {
  remainingCodes: string[]
}

export async function createSignedLdapTwoFactorCookieValue(identifier: string, secret: string): Promise<string> {
  const signature = await makeSignature(identifier, secret)
  return `${identifier}.${signature}`
}

export async function readSignedLdapTwoFactorCookieValue(
  value: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!value) return null

  const separatorIndex = value.lastIndexOf('.')
  if (separatorIndex <= 0) return null

  const identifier = value.slice(0, separatorIndex)
  const signature = value.slice(separatorIndex + 1)
  const expectedSignature = await makeSignature(identifier, secret)

  return signature === expectedSignature ? identifier : null
}

export async function verifyLdapTwoFactorCode(params: {
  credential: LdapTwoFactorCredential
  method: LdapTwoFactorMethod
  code: string
  secret: string
  digits?: number
  period?: number
}): Promise<{ ok: true; backupCode?: VerifiedBackupCode } | { ok: false }> {
  const code = params.code.trim()
  if (!code) return { ok: false }

  if (params.method === 'totp') {
    const sharedSecret = await symmetricDecrypt({
      key: params.secret,
      data: params.credential.secret,
    })

    const isValid = verifyTotpCode({
      secret: sharedSecret,
      code,
      digits: params.digits ?? 6,
      period: params.period ?? 30,
    })

    return isValid ? { ok: true } : { ok: false }
  }

  const backupCodes = await readBackupCodes(params.credential.backupCodes, params.secret)
  if (!backupCodes.includes(code)) {
    return { ok: false }
  }

  return {
    ok: true,
    backupCode: {
      remainingCodes: backupCodes.filter((backupCode) => backupCode !== code),
    },
  }
}

export function generateTotpCode(params: {
  secret: string
  digits?: number
  period?: number
  timestampMs?: number
}): string {
  const digits = params.digits ?? 6
  const period = params.period ?? 30
  const counter = Math.floor((params.timestampMs ?? Date.now()) / 1000 / period)

  return hotp(params.secret, counter, digits)
}

export async function encryptLdapBackupCodes(codes: string[], secret: string): Promise<string> {
  return symmetricEncrypt({
    key: secret,
    data: JSON.stringify(codes),
  })
}

export function serialiseLdapTwoFactorChallenge(challenge: LdapTwoFactorChallenge): string {
  return JSON.stringify(challenge)
}

export function parseLdapTwoFactorChallenge(value: string): LdapTwoFactorChallenge | null {
  try {
    const parsed = JSON.parse(value) as Partial<LdapTwoFactorChallenge>
    if (typeof parsed.userId !== 'string' || typeof parsed.username !== 'string') {
      return null
    }
    return {
      userId: parsed.userId,
      username: parsed.username,
    }
  } catch {
    return null
  }
}

async function readBackupCodes(value: string | null, secret: string): Promise<string[]> {
  if (!value) return []

  let decrypted = value
  try {
    decrypted = await symmetricDecrypt({
      key: secret,
      data: value,
    })
  } catch {
    decrypted = value
  }

  const parsed = JSON.parse(decrypted) as unknown
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
}

function verifyTotpCode(params: {
  secret: string
  code: string
  digits: number
  period: number
  timestampMs?: number
}): boolean {
  const timestampMs = params.timestampMs ?? Date.now()
  const currentCounter = Math.floor(timestampMs / 1000 / params.period)

  for (let offset = -1; offset <= 1; offset += 1) {
    if (hotp(params.secret, currentCounter + offset, params.digits) === params.code) {
      return true
    }
  }

  return false
}

function hotp(secret: string, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', Buffer.from(secret, 'utf8'))
    .update(counterBuffer)
    .digest()
  const offset = (digest.at(-1) ?? 0) & 0x0f
  const binary = (
    (((digest[offset] ?? 0) & 0x7f) << 24)
    | (((digest[offset + 1] ?? 0) & 0xff) << 16)
    | (((digest[offset + 2] ?? 0) & 0xff) << 8)
    | ((digest[offset + 3] ?? 0) & 0xff)
  )

  return String(binary % (10 ** digits)).padStart(digits, '0')
}
