import { z } from 'zod'
import type { PasswordVaultMemberRole, PasswordVaultStatus } from '@/lib/db/schema/password-vault.ts'

export const PASSWORD_VAULT_DISPLAY_ENVELOPE_VERSION = 'vault-display-envelope:v1'
export const PASSWORD_VAULT_KEY_WRAP_VERSION = 'vault-key-wrap:v1'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u

const Base64UrlStringSchema = z
  .string()
  .min(16)
  .max(50_000)
  .regex(BASE64URL_PATTERN, 'Expected base64url-encoded data')

export const PasswordVaultDisplayEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('AES-256-GCM'),
  iv: Base64UrlStringSchema.max(128),
  ciphertext: Base64UrlStringSchema.max(50_000),
}).strict()

export const PasswordVaultWrappedKeyEnvelopeSchema = PasswordVaultDisplayEnvelopeSchema.extend({
  wrapVersion: z.literal(1),
  salt: Base64UrlStringSchema.max(256),
}).strict()

export const CreatePasswordVaultSchema = z.object({
  encryptedDisplayEnvelope: PasswordVaultDisplayEnvelopeSchema,
  wrappedVaultKeyEnvelope: PasswordVaultWrappedKeyEnvelopeSchema,
  displayEnvelopeVersion: z.literal(PASSWORD_VAULT_DISPLAY_ENVELOPE_VERSION),
  keyWrapVersion: z.literal(PASSWORD_VAULT_KEY_WRAP_VERSION),
}).strict()

export const UpdatePasswordVaultSchema = z.object({
  encryptedDisplayEnvelope: PasswordVaultDisplayEnvelopeSchema,
}).strict()

export type PasswordVaultDisplayEnvelopePayload = z.infer<typeof PasswordVaultDisplayEnvelopeSchema>
export type PasswordVaultWrappedKeyEnvelopePayload = z.infer<typeof PasswordVaultWrappedKeyEnvelopeSchema>
export type CreatePasswordVaultPayload = z.infer<typeof CreatePasswordVaultSchema>
export type UpdatePasswordVaultPayload = z.infer<typeof UpdatePasswordVaultSchema>

export type SerializablePasswordVault = {
  id: string
  encryptedDisplayEnvelope: unknown
  status: PasswordVaultStatus
  createdAt: Date
  updatedAt: Date
  memberRole: PasswordVaultMemberRole
  wrappedVaultKeyEnvelope: unknown
  keyEpochId: string
  keyEpochNumber: number
  keyWrapVersion: string
}

export type PasswordVaultResponse = {
  id: string
  encryptedDisplayEnvelope: PasswordVaultDisplayEnvelopePayload
  status: PasswordVaultStatus
  currentUserRole: PasswordVaultMemberRole
  wrappedVaultKeyEnvelope: PasswordVaultWrappedKeyEnvelopePayload
  keyEpoch: {
    id: string
    epochNumber: number
    wrapVersion: typeof PASSWORD_VAULT_KEY_WRAP_VERSION
  }
  createdAt: string
  updatedAt: string
}

export function parseCreatePasswordVaultPayload(value: unknown): CreatePasswordVaultPayload {
  return CreatePasswordVaultSchema.parse(value)
}

export function parseUpdatePasswordVaultPayload(value: unknown): UpdatePasswordVaultPayload {
  return UpdatePasswordVaultSchema.parse(value)
}

export function serializePasswordVault(vault: SerializablePasswordVault): PasswordVaultResponse {
  if (vault.keyWrapVersion !== PASSWORD_VAULT_KEY_WRAP_VERSION) {
    throw new Error('Unsupported Password Vault key wrap version')
  }

  return {
    id: vault.id,
    encryptedDisplayEnvelope: PasswordVaultDisplayEnvelopeSchema.parse(vault.encryptedDisplayEnvelope),
    status: vault.status,
    currentUserRole: vault.memberRole,
    wrappedVaultKeyEnvelope: PasswordVaultWrappedKeyEnvelopeSchema.parse(vault.wrappedVaultKeyEnvelope),
    keyEpoch: {
      id: vault.keyEpochId,
      epochNumber: vault.keyEpochNumber,
      wrapVersion: PASSWORD_VAULT_KEY_WRAP_VERSION,
    },
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
  }
}

export function createPasswordVaultDeletedResponse(vaultId: string): { id: string; deleted: true } {
  return {
    id: vaultId,
    deleted: true,
  }
}
