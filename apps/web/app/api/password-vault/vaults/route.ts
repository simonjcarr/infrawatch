import {
  createPasswordVault,
  listPasswordVaults,
} from '@/lib/password-vault/vault-routes'

export const runtime = 'nodejs'

export const GET = listPasswordVaults
export const POST = createPasswordVault
