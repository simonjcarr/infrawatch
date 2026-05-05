import type {
  PasswordManagerEntrySummary,
  PasswordManagerVaultSummary,
} from './workspace.ts'

export interface PasswordManagerVaultExportBundle {
  blob: Blob
  fileName: string
  mediaType: 'application/json'
}

export function createPasswordManagerVaultExportBundle(input: {
  vault: PasswordManagerVaultSummary
  entries: PasswordManagerEntrySummary[]
  exportedAt?: string
}): PasswordManagerVaultExportBundle {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const payload = {
    exported_at: exportedAt,
    vault: {
      id: input.vault.id,
      name: input.vault.metadata.name,
      description: input.vault.metadata.description ?? null,
      role: input.vault.role,
      current_key_epoch: input.vault.currentKeyEpoch,
      updated_at: input.vault.updatedAt,
    },
    entries: input.entries.map((entry) => ({
      id: entry.id,
      title: entry.payload.title,
      username: entry.payload.username,
      password: entry.payload.password,
      url: entry.payload.url ?? null,
      notes: entry.payload.notes ?? null,
      key_epoch: entry.keyEpoch,
      updated_at: entry.updatedAt,
    })),
  }
  const fileName = `${slugifyFileStem(input.vault.metadata.name)}-${exportedAt.replaceAll(':', '-')}.password-manager.json`

  return {
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    fileName,
    mediaType: 'application/json',
  }
}

function slugifyFileStem(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'password-manager-vault'
}
