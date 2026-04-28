import { decrypt } from '../crypto/encrypt.ts'

type LdapTlsConfig = {
  useTls: boolean
  useStartTls: boolean
  tlsCertificate: string | null
}

function safeDecrypt(value: string): string {
  try { return decrypt(value) } catch { return value }
}

export function getTlsOptions(config: LdapTlsConfig): Record<string, unknown> | undefined {
  if (!config.useTls && !config.useStartTls) return undefined
  return config.tlsCertificate
    ? { ca: [safeDecrypt(config.tlsCertificate)], rejectUnauthorized: true }
    : {}
}
