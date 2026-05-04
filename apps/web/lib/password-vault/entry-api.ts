import { z } from 'zod'
import { PasswordVaultDisplayEnvelopeSchema } from './vault-api.ts'

export const PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION = 'vault-entry-envelope:v1'

export const PasswordVaultEntryEnvelopeSchema = PasswordVaultDisplayEnvelopeSchema

export const CreatePasswordVaultEntrySchema = z.object({
  encryptedPayloadEnvelope: PasswordVaultEntryEnvelopeSchema,
  encryptedDisplayEnvelope: PasswordVaultEntryEnvelopeSchema,
  envelopeVersion: z.literal(PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION),
}).strict()

export const UpdatePasswordVaultEntrySchema = z.object({
  encryptedPayloadEnvelope: PasswordVaultEntryEnvelopeSchema,
  encryptedDisplayEnvelope: PasswordVaultEntryEnvelopeSchema,
}).strict()

export type PasswordVaultEntryEnvelopePayload = z.infer<typeof PasswordVaultEntryEnvelopeSchema>
export type CreatePasswordVaultEntryPayload = z.infer<typeof CreatePasswordVaultEntrySchema>
export type UpdatePasswordVaultEntryPayload = z.infer<typeof UpdatePasswordVaultEntrySchema>

export type SerializablePasswordVaultEntry = {
  id: string
  vaultId: string
  encryptedPayloadEnvelope: unknown
  encryptedDisplayEnvelope: unknown
  envelopeVersion: string
  createdAt: Date
  updatedAt: Date
}

export type PasswordVaultEntryResponse = {
  id: string
  vaultId: string
  encryptedPayloadEnvelope: PasswordVaultEntryEnvelopePayload
  encryptedDisplayEnvelope: PasswordVaultEntryEnvelopePayload
  envelopeVersion: typeof PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION
  createdAt: string
  updatedAt: string
}

export function parseCreatePasswordVaultEntryPayload(value: unknown): CreatePasswordVaultEntryPayload {
  return CreatePasswordVaultEntrySchema.parse(value)
}

export function parseUpdatePasswordVaultEntryPayload(value: unknown): UpdatePasswordVaultEntryPayload {
  return UpdatePasswordVaultEntrySchema.parse(value)
}

export function serializePasswordVaultEntry(entry: SerializablePasswordVaultEntry): PasswordVaultEntryResponse {
  if (entry.envelopeVersion !== PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION) {
    throw new Error('Unsupported Password Vault entry envelope version')
  }

  return {
    id: entry.id,
    vaultId: entry.vaultId,
    encryptedPayloadEnvelope: PasswordVaultEntryEnvelopeSchema.parse(entry.encryptedPayloadEnvelope),
    encryptedDisplayEnvelope: PasswordVaultEntryEnvelopeSchema.parse(entry.encryptedDisplayEnvelope),
    envelopeVersion: PASSWORD_VAULT_ENTRY_ENVELOPE_VERSION,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export function createPasswordVaultEntryDeletedResponse(entryId: string): { id: string; deleted: true } {
  return {
    id: entryId,
    deleted: true,
  }
}
