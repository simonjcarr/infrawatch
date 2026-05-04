import { NextRequest } from 'next/server'
import {
  deletePasswordVaultEntry,
  getPasswordVaultEntry,
  updatePasswordVaultEntry,
} from '@/lib/password-vault/entry-routes'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; entryId: string }> },
) {
  const { vaultId, entryId } = await params
  return getPasswordVaultEntry(request, vaultId, entryId)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; entryId: string }> },
) {
  const { vaultId, entryId } = await params
  return updatePasswordVaultEntry(request, vaultId, entryId)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; entryId: string }> },
) {
  const { vaultId, entryId } = await params
  return deletePasswordVaultEntry(request, vaultId, entryId)
}
