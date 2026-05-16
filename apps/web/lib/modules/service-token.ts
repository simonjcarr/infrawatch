import { createHash, createHmac, randomUUID } from 'node:crypto'

const TOKEN_ID_RE = /^[A-Za-z0-9._:-]{3,128}$/

export interface ModuleServiceToken {
  id: string
  secret: string
}

export interface SignedModuleRequestHeaders {
  authorization: string
  'x-ct-timestamp': string
  'x-ct-nonce': string
  'x-ct-content-sha256': string
  'x-ct-signature': string
}

export function normaliseModuleBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Module base URL must be an absolute http(s) URL')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Module base URL must be an absolute http(s) URL')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function normaliseModuleTokenId(value: string): string {
  const tokenId = value.trim()
  if (!TOKEN_ID_RE.test(tokenId)) {
    throw new Error('Module token ID must be 3-128 characters and contain only letters, numbers, dots, underscores, colons, or dashes')
  }
  return tokenId
}

export function buildSignedModuleRequestHeaders(options: {
  method: string
  path: string
  body: string | Buffer
  token: ModuleServiceToken
  timestamp?: string
  nonce?: string
}): SignedModuleRequestHeaders {
  const timestamp = options.timestamp ?? new Date().toISOString()
  const nonce = options.nonce ?? randomUUID()
  const bodyHash = createHash('sha256').update(options.body).digest('hex')
  const signature = createHmac('sha256', options.token.secret)
    .update([
      options.method.toUpperCase(),
      options.path,
      timestamp,
      nonce,
      bodyHash,
    ].join('\n'))
    .digest('base64url')

  return {
    authorization: `CT-ServiceToken ${options.token.id}`,
    'x-ct-timestamp': timestamp,
    'x-ct-nonce': nonce,
    'x-ct-content-sha256': bodyHash,
    'x-ct-signature': `v1=${signature}`,
  }
}
