import { NextRequest } from 'next/server'
import { recordPasswordVaultEntryCopyAudit } from '@/lib/password-vault/audit-routes'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; entryId: string }> },
) {
  const { vaultId, entryId } = await params
  return recordPasswordVaultEntryCopyAudit(request, vaultId, entryId)
}
