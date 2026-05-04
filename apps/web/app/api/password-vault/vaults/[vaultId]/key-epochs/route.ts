import { NextRequest } from 'next/server'
import { rotatePasswordVaultKeyEpoch } from '@/lib/password-vault/sharing-routes'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return rotatePasswordVaultKeyEpoch(request, vaultId)
}
