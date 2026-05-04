import { NextRequest } from 'next/server'
import {
  removePasswordVaultMember,
  updatePasswordVaultMember,
} from '@/lib/password-vault/sharing-routes'

export const runtime = 'nodejs'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; userId: string }> },
) {
  const { vaultId, userId } = await params
  return updatePasswordVaultMember(request, vaultId, userId)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; userId: string }> },
) {
  const { vaultId, userId } = await params
  return removePasswordVaultMember(request, vaultId, userId)
}
