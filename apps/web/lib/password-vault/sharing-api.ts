import { z } from 'zod'
import type {
  PasswordVaultMemberRole,
  PasswordVaultRotationReason,
} from '../db/schema/password-vault.ts'
import {
  PASSWORD_VAULT_MEMBER_ROLES,
  PASSWORD_VAULT_ROTATION_REASONS,
} from '../db/schema/password-vault.ts'
import { PasswordVaultWrappedKeyEnvelopeSchema } from './vault-api.ts'

export const PASSWORD_VAULT_KEY_ROTATION_IDEMPOTENCY_VERSION = 'vault-key-rotation-idempotency:v1'

const IdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Expected a stable opaque identifier')

const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/u, 'Expected an idempotency key')

const MemberRoleSchema = z.enum(PASSWORD_VAULT_MEMBER_ROLES)
const RotationReasonSchema = z.enum(PASSWORD_VAULT_ROTATION_REASONS)

export const AddPasswordVaultMemberSchema = z.object({
  userId: IdSchema,
  role: MemberRoleSchema,
  wrappedVaultKeyEnvelope: PasswordVaultWrappedKeyEnvelopeSchema,
  idempotencyKey: IdempotencyKeySchema.optional(),
}).strict()

export const UpdatePasswordVaultMemberSchema = z.object({
  role: MemberRoleSchema,
  wrappedVaultKeyEnvelope: PasswordVaultWrappedKeyEnvelopeSchema.optional(),
  idempotencyKey: IdempotencyKeySchema.optional(),
}).strict()

export const RotatePasswordVaultKeyEpochSchema = z.object({
  rotationReason: RotationReasonSchema.exclude(['initial']),
  idempotencyKey: IdempotencyKeySchema,
  memberKeyWraps: z.array(z.object({
    userId: IdSchema,
    wrappedVaultKeyEnvelope: PasswordVaultWrappedKeyEnvelopeSchema,
  }).strict()).min(1).max(500),
}).strict()

export type AddPasswordVaultMemberPayload = z.infer<typeof AddPasswordVaultMemberSchema>
export type UpdatePasswordVaultMemberPayload = z.infer<typeof UpdatePasswordVaultMemberSchema>
export type RotatePasswordVaultKeyEpochPayload = z.infer<typeof RotatePasswordVaultKeyEpochSchema>

export type SerializablePasswordVaultMember = {
  userId: string
  name: string
  email: string
  role: PasswordVaultMemberRole
  keyEpochId: string
  keyEpochNumber: number
  createdAt: Date
  updatedAt: Date
  revokedAt: Date | null
}

export type PasswordVaultMemberResponse = {
  userId: string
  name: string
  email: string
  role: PasswordVaultMemberRole
  keyEpoch: {
    id: string
    epochNumber: number
  }
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

export type PasswordVaultKeyEpochResponse = {
  id: string
  epochNumber: number
  rotationReason: Exclude<PasswordVaultRotationReason, 'initial'>
  idempotencyKey: string
  idempotencyVersion: typeof PASSWORD_VAULT_KEY_ROTATION_IDEMPOTENCY_VERSION
  createdAt: string
}

export function parseAddPasswordVaultMemberPayload(value: unknown): AddPasswordVaultMemberPayload {
  return AddPasswordVaultMemberSchema.parse(value)
}

export function parseUpdatePasswordVaultMemberPayload(value: unknown): UpdatePasswordVaultMemberPayload {
  return UpdatePasswordVaultMemberSchema.parse(value)
}

export function parseRotatePasswordVaultKeyEpochPayload(value: unknown): RotatePasswordVaultKeyEpochPayload {
  const payload = RotatePasswordVaultKeyEpochSchema.parse(value)
  const seen = new Set<string>()

  for (const wrap of payload.memberKeyWraps) {
    if (seen.has(wrap.userId)) {
      throw new Error('Duplicate Password Vault member key wrap')
    }
    seen.add(wrap.userId)
  }

  return payload
}

export function serializePasswordVaultMember(
  member: SerializablePasswordVaultMember,
): PasswordVaultMemberResponse {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    keyEpoch: {
      id: member.keyEpochId,
      epochNumber: member.keyEpochNumber,
    },
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    revokedAt: member.revokedAt?.toISOString() ?? null,
  }
}

export function createPasswordVaultMemberDeletedResponse(userId: string): { userId: string; deleted: true } {
  return {
    userId,
    deleted: true,
  }
}

export function createPasswordVaultKeyEpochResponse(epoch: {
  id: string
  epochNumber: number
  rotationReason: Exclude<PasswordVaultRotationReason, 'initial'>
  idempotencyKey: string
  createdAt: Date
}): PasswordVaultKeyEpochResponse {
  return {
    id: epoch.id,
    epochNumber: epoch.epochNumber,
    rotationReason: epoch.rotationReason,
    idempotencyKey: epoch.idempotencyKey,
    idempotencyVersion: PASSWORD_VAULT_KEY_ROTATION_IDEMPOTENCY_VERSION,
    createdAt: epoch.createdAt.toISOString(),
  }
}

export function willLeaveVaultWithoutOwner(input: {
  activeOwnerUserIds: readonly string[]
  targetUserId: string
  replacementRole: PasswordVaultMemberRole | null
}): boolean {
  if (!input.activeOwnerUserIds.includes(input.targetUserId)) {
    return false
  }

  if (input.replacementRole === 'owner') {
    return false
  }

  return input.activeOwnerUserIds.length <= 1
}
