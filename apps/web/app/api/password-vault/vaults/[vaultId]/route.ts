import { NextRequest } from 'next/server'
import {
  deletePasswordVault,
  getPasswordVault,
  updatePasswordVault,
} from '@/lib/password-vault/vault-routes'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return getPasswordVault(request, vaultId)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return updatePasswordVault(request, vaultId)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return deletePasswordVault(request, vaultId)
}
