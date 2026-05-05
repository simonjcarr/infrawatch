const TRUST_PROXY_HEADERS_VALUES = new Set(['1', 'true', 'yes', 'on'])

interface HeaderReader {
  get(name: string): string | null
}

function trustsProxyHeaders(): boolean {
  return TRUST_PROXY_HEADERS_VALUES.has(
    (process.env.CT_OPS_TRUST_PROXY_HEADERS ?? '').trim().toLowerCase(),
  )
}

function isValidIpAddress(value: string): boolean {
  if (value.length === 0 || value.length > 45 || /[\s\r\n]/.test(value)) {
    return false
  }

  const ipv4Parts = value.split('.')
  if (ipv4Parts.length === 4) {
    return ipv4Parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false
      const parsed = Number(part)
      return parsed >= 0 && parsed <= 255 && String(parsed) === part
    })
  }

  return /^[0-9a-f:]+$/i.test(value) && value.includes(':')
}

function firstForwardedForAddress(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first && isValidIpAddress(first) ? first : null
}

function realIpAddress(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed && isValidIpAddress(trimmed) ? trimmed : null
}

export function getClientIpFromHeaders(headers: HeaderReader): string {
  if (!trustsProxyHeaders()) return 'unknown'

  return (
    firstForwardedForAddress(headers.get('x-forwarded-for')) ??
    realIpAddress(headers.get('x-real-ip')) ??
    'unknown'
  )
}
