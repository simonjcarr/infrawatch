import type { Metadata } from 'next'
import { PasswordVaultClient } from './password-vault-client'

export const metadata: Metadata = {
  title: 'Password Vault',
}

export default function PasswordVaultPage() {
  return <PasswordVaultClient />
}
