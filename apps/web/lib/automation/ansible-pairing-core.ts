import type { ModuleTlsMode } from '@/lib/db/schema'
import type { ModuleConnectionInput } from '@/lib/modules/module-connections'

export const ANSIBLE_PAIRING_TIMEOUT_MS = 5000

export function inferAnsibleTlsMode(baseUrl: string): ModuleTlsMode {
  return new URL(baseUrl.trim()).protocol === 'http:' ? 'insecure' : 'public-ca'
}

export function buildAnsiblePairingConnectionInput(input: {
  baseUrl: string
  tokenId: string
  tokenSecret: string
}): Omit<ModuleConnectionInput, 'moduleType'> {
  return {
    enabled: true,
    name: 'Primary Ansible API',
    baseUrl: input.baseUrl.trim(),
    authMode: 'service-token-hmac',
    tokenId: input.tokenId,
    tokenSecret: input.tokenSecret,
    tlsMode: inferAnsibleTlsMode(input.baseUrl),
    timeoutMs: ANSIBLE_PAIRING_TIMEOUT_MS,
  }
}
