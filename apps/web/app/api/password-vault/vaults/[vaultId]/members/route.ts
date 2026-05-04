import { NextRequest } from 'next/server'
import {
  addPasswordVaultMember,
  listPasswordVaultMembers,
} from '@/lib/password-vault/sharing-routes'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return listPasswordVaultMembers(request, vaultId)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return addPasswordVaultMember(request, vaultId)
}
