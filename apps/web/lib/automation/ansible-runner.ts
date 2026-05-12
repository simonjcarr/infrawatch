import type { AnsibleInventoryHost, Host } from '@/lib/db/schema'

const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const PASSWORD_FIELD_RE = /(["']?\b(?:ansible_(?:ssh_)?pass(?:word)?|password|private_key|privateKey)\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi

export function validateSshPrivateKey(value: string): boolean {
  return /-----BEGIN (?:(?:OPENSSH|RSA|EC|DSA) PRIVATE KEY|PRIVATE KEY)-----[\s\S]+-----END (?:(?:OPENSSH|RSA|EC|DSA) PRIVATE KEY|PRIVATE KEY)-----/.test(value.trim())
}

export function redactAnsibleOutput(output: string): string {
  return output
    .replace(PRIVATE_KEY_RE, '[REDACTED PRIVATE KEY]')
    .replace(PASSWORD_FIELD_RE, (_match, key) => `${key}[REDACTED]`)
}

export function buildAnsibleInventoryHost(
  host: Pick<Host, 'id' | 'hostname' | 'displayName' | 'ipAddresses'>,
  sshPort = 22,
): AnsibleInventoryHost {
  const addresses = Array.isArray(host.ipAddresses) ? host.ipAddresses.filter(Boolean) : []
  return {
    id: host.id,
    name: host.hostname,
    address: addresses[0] ?? host.hostname,
    port: sshPort,
  }
}
