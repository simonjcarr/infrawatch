import type { AuditEventInput } from '@/lib/audit/events-core'
import type { PasswordVaultMemberRole } from '@/lib/db/schema/password-vault.ts'
import { z } from 'zod'

export const PASSWORD_VAULT_AUDIT_ACTIONS = {
  setup_completed: 'password_vault.setup_completed',
  unlock_succeeded: 'password_vault.unlock_succeeded',
  unlock_failed: 'password_vault.unlock_failed',
  vault_created: 'password_vault.vault_created',
  vault_updated: 'password_vault.vault_updated',
  vault_deleted: 'password_vault.vault_deleted',
  entry_created: 'password_vault.entry_created',
  entry_updated: 'password_vault.entry_updated',
  entry_deleted: 'password_vault.entry_deleted',
  entry_revealed: 'password_vault.entry_revealed',
  entry_copied: 'password_vault.entry_copied',
  vault_exported: 'password_vault.vault_exported',
  member_added: 'password_vault.member_added',
  member_revoked: 'password_vault.member_revoked',
  member_role_changed: 'password_vault.member_role_changed',
  key_rotated: 'password_vault.key_rotated',
} as const

export type PasswordVaultAuditEvent = keyof typeof PASSWORD_VAULT_AUDIT_ACTIONS

export const PasswordVaultUnlockAuditSchema = z.object({
  result: z.enum(['success', 'failure']),
}).strict()

export type PasswordVaultUnlockAuditPayload = z.infer<typeof PasswordVaultUnlockAuditSchema>

type BasePasswordVaultAuditInput = {
  organisationId: string
  actorUserId: string
}

type PasswordVaultAuditInput = BasePasswordVaultAuditInput & (
  | { event: 'setup_completed' | 'unlock_succeeded' | 'unlock_failed' }
  | { event: 'vault_created' | 'vault_updated' | 'vault_deleted' | 'vault_exported', vaultId: string }
  | { event: 'entry_created' | 'entry_updated' | 'entry_deleted' | 'entry_revealed' | 'entry_copied', vaultId: string, entryId: string }
  | { event: 'member_added' | 'member_revoked', vaultId: string, targetUserId: string, role?: PasswordVaultMemberRole }
  | { event: 'member_role_changed', vaultId: string, targetUserId: string, role: PasswordVaultMemberRole }
  | {
      event: 'key_rotated'
      vaultId: string
      keyEpochId: string
      keyEpochNumber: number
      rotationReason: string
      memberCount: number
    }
)

const PASSWORD_VAULT_AUDIT_SUMMARIES: Record<PasswordVaultAuditEvent, string> = {
  setup_completed: 'Password Vault setup was completed.',
  unlock_succeeded: 'Password Vault unlock succeeded.',
  unlock_failed: 'Password Vault unlock failed.',
  vault_created: 'Password Vault was created.',
  vault_updated: 'Password Vault metadata was updated.',
  vault_deleted: 'Password Vault was deleted.',
  entry_created: 'Password Vault entry was created.',
  entry_updated: 'Password Vault entry was updated.',
  entry_deleted: 'Password Vault entry was deleted.',
  entry_revealed: 'Password Vault entry was revealed.',
  entry_copied: 'Password Vault entry was copied.',
  vault_exported: 'Password Vault export was requested.',
  member_added: 'Password Vault member was added.',
  member_revoked: 'Password Vault member was revoked.',
  member_role_changed: 'Password Vault member role was changed.',
  key_rotated: 'Password Vault key epoch was rotated.',
}

function targetFor(input: PasswordVaultAuditInput): Pick<AuditEventInput, 'targetType' | 'targetId'> {
  switch (input.event) {
    case 'setup_completed':
    case 'unlock_succeeded':
    case 'unlock_failed':
      return { targetType: 'password_vault_user', targetId: input.actorUserId }
    case 'entry_created':
    case 'entry_updated':
    case 'entry_deleted':
    case 'entry_revealed':
    case 'entry_copied':
      return { targetType: 'password_vault_entry', targetId: input.entryId }
    case 'member_added':
    case 'member_revoked':
    case 'member_role_changed':
      return { targetType: 'password_vault_member', targetId: input.targetUserId }
    case 'key_rotated':
      return { targetType: 'password_vault_key_epoch', targetId: input.keyEpochId }
    case 'vault_created':
    case 'vault_updated':
    case 'vault_deleted':
    case 'vault_exported':
      return { targetType: 'password_vault', targetId: input.vaultId }
  }
}

function metadataFor(input: PasswordVaultAuditInput): Record<string, string | number> | undefined {
  switch (input.event) {
    case 'setup_completed':
    case 'unlock_succeeded':
    case 'unlock_failed':
      return undefined
    case 'entry_created':
    case 'entry_updated':
    case 'entry_deleted':
    case 'entry_revealed':
    case 'entry_copied':
    case 'vault_created':
    case 'vault_updated':
    case 'vault_deleted':
    case 'vault_exported':
      return { vaultId: input.vaultId }
    case 'member_added':
    case 'member_revoked':
      return input.role
        ? { vaultId: input.vaultId, targetUserId: input.targetUserId, role: input.role }
        : { vaultId: input.vaultId, targetUserId: input.targetUserId }
    case 'member_role_changed':
      return { vaultId: input.vaultId, targetUserId: input.targetUserId, role: input.role }
    case 'key_rotated':
      return {
        vaultId: input.vaultId,
        keyEpochNumber: input.keyEpochNumber,
        rotationReason: input.rotationReason,
        memberCount: input.memberCount,
      }
  }
}

export function buildPasswordVaultAuditEvent(input: PasswordVaultAuditInput): AuditEventInput {
  const target = targetFor(input)

  return {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: PASSWORD_VAULT_AUDIT_ACTIONS[input.event],
    targetType: target.targetType,
    targetId: target.targetId,
    summary: PASSWORD_VAULT_AUDIT_SUMMARIES[input.event],
    metadata: metadataFor(input),
  }
}

export function parsePasswordVaultUnlockAuditPayload(value: unknown): PasswordVaultUnlockAuditPayload {
  return PasswordVaultUnlockAuditSchema.parse(value)
}

export function createPasswordVaultAuditResponse(): { recorded: true } {
  return { recorded: true }
}
