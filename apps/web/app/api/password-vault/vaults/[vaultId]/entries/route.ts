import { NextRequest } from 'next/server'
import {
  createPasswordVaultEntry,
  listPasswordVaultEntries,
} from '@/lib/password-vault/entry-routes'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return listPasswordVaultEntries(request, vaultId)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return createPasswordVaultEntry(request, vaultId)
}
