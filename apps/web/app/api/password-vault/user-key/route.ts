import {
  getPasswordVaultUserKey,
  putPasswordVaultUserKey,
} from '@/lib/password-vault/profile-routes'

export const runtime = 'nodejs'

export const GET = getPasswordVaultUserKey
export const PUT = putPasswordVaultUserKey
