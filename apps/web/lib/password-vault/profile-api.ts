import { z } from 'zod'
import type { PasswordVaultUserKey } from '@/lib/db/schema/password-vault.ts'

export const PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION = 'private-key-envelope:v1'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u

const Base64UrlStringSchema = z
  .string()
  .min(16)
  .max(20_000)
  .regex(BASE64URL_PATTERN, 'Expected base64url-encoded data')

export const PasswordVaultKdfParamsSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('argon2id'),
  memoryKiB: z.number().int().min(64 * 1024).max(1024 * 1024),
  iterations: z.number().int().min(3).max(20),
  parallelism: z.number().int().min(1).max(8),
  keyLength: z.literal(32),
  salt: Base64UrlStringSchema.max(256),
}).strict()

export const PasswordVaultPrivateKeyEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('AES-256-GCM'),
  iv: Base64UrlStringSchema.max(128),
  ciphertext: Base64UrlStringSchema.max(20_000),
}).strict()

export const PutPasswordVaultUserKeySchema = z.object({
  publicKey: Base64UrlStringSchema.max(2048),
  encryptedPrivateKeyEnvelope: PasswordVaultPrivateKeyEnvelopeSchema,
  kdfParams: PasswordVaultKdfParamsSchema,
  envelopeVersion: z.literal(PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION),
}).strict()

export type PasswordVaultKdfParamsPayload = z.infer<typeof PasswordVaultKdfParamsSchema>
export type PasswordVaultPrivateKeyEnvelopePayload = z.infer<typeof PasswordVaultPrivateKeyEnvelopeSchema>
export type PutPasswordVaultUserKeyPayload = z.infer<typeof PutPasswordVaultUserKeySchema>

export type PasswordVaultSetupStatusResponse = {
  configured: boolean
  setupCompletedAt: string | null
}

export type PasswordVaultUserKeyResponse = {
  configured: true
  publicKey: string
  encryptedPrivateKeyEnvelope: PasswordVaultPrivateKeyEnvelopePayload
  kdfParams: PasswordVaultKdfParamsPayload
  envelopeVersion: typeof PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION
  setupCompletedAt: string
  updatedAt: string
}

export type PasswordVaultUnlockMetadataResponse = PasswordVaultUserKeyResponse

export function parsePasswordVaultUserKeyPayload(value: unknown): PutPasswordVaultUserKeyPayload {
  return PutPasswordVaultUserKeySchema.parse(value)
}

export function createPasswordVaultSetupStatus(
  userKey: Pick<PasswordVaultUserKey, 'setupCompletedAt'> | null | undefined,
): PasswordVaultSetupStatusResponse {
  return {
    configured: Boolean(userKey),
    setupCompletedAt: userKey?.setupCompletedAt.toISOString() ?? null,
  }
}

export function serializePasswordVaultUserKey(
  userKey: Pick<
    PasswordVaultUserKey,
    | 'encryptedPrivateKeyEnvelope'
    | 'envelopeVersion'
    | 'kdfParams'
    | 'publicKey'
    | 'setupCompletedAt'
    | 'updatedAt'
  >,
): PasswordVaultUserKeyResponse {
  const parsedEnvelope = PasswordVaultPrivateKeyEnvelopeSchema.parse(userKey.encryptedPrivateKeyEnvelope)
  const parsedKdfParams = PasswordVaultKdfParamsSchema.parse(userKey.kdfParams)

  if (userKey.envelopeVersion !== PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION) {
    throw new Error('Unsupported Password Vault user-key envelope version')
  }

  return {
    configured: true,
    publicKey: userKey.publicKey,
    encryptedPrivateKeyEnvelope: parsedEnvelope,
    kdfParams: parsedKdfParams,
    envelopeVersion: PASSWORD_VAULT_USER_KEY_ENVELOPE_VERSION,
    setupCompletedAt: userKey.setupCompletedAt.toISOString(),
    updatedAt: userKey.updatedAt.toISOString(),
  }
}

export function createPasswordVaultUserKeyConflictResponse(): { message: string } {
  return {
    message: 'Password Vault has already been set up for this user.',
  }
}
