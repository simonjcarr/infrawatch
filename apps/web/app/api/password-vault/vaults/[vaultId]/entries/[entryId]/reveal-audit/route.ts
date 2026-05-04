import { NextRequest } from 'next/server'
import { recordPasswordVaultEntryRevealAudit } from '@/lib/password-vault/audit-routes'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string; entryId: string }> },
) {
  const { vaultId, entryId } = await params
  return recordPasswordVaultEntryRevealAudit(request, vaultId, entryId)
}
