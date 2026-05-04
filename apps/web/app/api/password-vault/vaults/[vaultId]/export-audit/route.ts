import { NextRequest } from 'next/server'
import { recordPasswordVaultExportAudit } from '@/lib/password-vault/audit-routes'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vaultId: string }> },
) {
  const { vaultId } = await params
  return recordPasswordVaultExportAudit(request, vaultId)
}
