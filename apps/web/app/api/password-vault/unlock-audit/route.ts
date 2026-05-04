import { NextRequest } from 'next/server'
import { recordPasswordVaultUnlockAudit } from '@/lib/password-vault/audit-routes'

export const runtime = 'nodejs'

export const POST = (request: NextRequest) => recordPasswordVaultUnlockAudit(request)
