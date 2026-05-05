import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type CtCveServiceTokenScope = 'findings:write' | 'inventory:write' | 'connection:read'

export interface CtCveServiceToken {
  id: string
  secret: string
  orgId: string
  scopes: CtCveServiceTokenScope[]
  revoked?: boolean
}

export interface CtCveNonceStore {
  remember(tokenId: string, nonce: string, expiresAt: Date, now?: Date): Promise<boolean>
}

export interface CtCveServiceAuthError {
  code:
    | 'missing_authorization'
    | 'invalid_authorization'
    | 'unknown_token'
    | 'revoked_token'
    | 'missing_header'
    | 'invalid_timestamp'
    | 'timestamp_out_of_range'
    | 'content_hash_mismatch'
    | 'invalid_signature'
    | 'insufficient_scope'
    | 'org_scope_mismatch'
    | 'replayed_nonce'
  message: string
  retryable: boolean
  status: number
}

export type CtCveServiceAuthResult =
  | { ok: true; token: CtCveServiceToken }
  | { ok: false; error: CtCveServiceAuthError }

type HeaderBag = Headers | Record<string, string | undefined | null>

const AUTH_SCHEME = 'CT-ServiceToken'
const SIGNATURE_PREFIX = 'v1='
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const NONCE_TTL_MS = 10 * 60 * 1000
const HEX_SHA256_RE = /^[a-f0-9]{64}$/

function fail(error: CtCveServiceAuthError['code'], status: number, message: string, retryable = false): CtCveServiceAuthResult {
  return {
    ok: false,
    error: { code: error, status, message, retryable },
  }
}

function getHeader(headers: HeaderBag, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name)
  }

  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return typeof value === 'string' ? value : null
    }
  }
  return null
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer)
}

function bodySha256(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

function signatureInput(options: {
  method: string
  path: string
  timestamp: string
  nonce: string
  bodyHash: string
}) {
  return `${options.method.toUpperCase()}\n${options.path}\n${options.timestamp}\n${options.nonce}\n${options.bodyHash}`
}

export function createInMemoryCtCveNonceStore(): CtCveNonceStore {
  const seen = new Map<string, number>()

  return {
    async remember(tokenId, nonce, expiresAt, now = new Date()) {
      const nowMs = now.getTime()
      for (const [key, expiresMs] of seen.entries()) {
        if (expiresMs <= nowMs) {
          seen.delete(key)
        }
      }

      const key = `${tokenId}:${nonce}`
      if (seen.has(key)) {
        return false
      }

      seen.set(key, expiresAt.getTime())
      return true
    },
  }
}

let defaultNonceStore: CtCveNonceStore | undefined

function getDefaultCtCveNonceStore(): CtCveNonceStore {
  defaultNonceStore ??= {
    async remember(tokenId, nonce, expiresAt, now) {
      const { dbCtCveNonceStore } = await import('./db-nonce-store.ts')
      return dbCtCveNonceStore.remember(tokenId, nonce, expiresAt, now)
    },
  }
  return defaultNonceStore
}

export const ctCveNonceStore: CtCveNonceStore = {
  remember(tokenId, nonce, expiresAt, now) {
    return getDefaultCtCveNonceStore().remember(tokenId, nonce, expiresAt, now)
  },
}

export async function verifyCtCveServiceRequest(options: {
  method: string
  path: string
  body: string | Buffer
  headers: HeaderBag
  requiredScope: CtCveServiceTokenScope
  orgId: string
  tokens: CtCveServiceToken[]
  nonceStore?: CtCveNonceStore
  now?: Date
}): Promise<CtCveServiceAuthResult> {
  const authorization = getHeader(options.headers, 'authorization')
  if (!authorization) {
    return fail('missing_authorization', 401, 'Missing CT-CVE service token authorization header.')
  }

  const [scheme, tokenId, extra] = authorization.trim().split(/\s+/)
  if (scheme !== AUTH_SCHEME || !tokenId || extra) {
    return fail('invalid_authorization', 401, 'Invalid CT-CVE service token authorization header.')
  }

  const token = options.tokens.find((candidate) => candidate.id === tokenId)
  if (!token) {
    return fail('unknown_token', 401, 'CT-CVE service token was not found.')
  }
  if (token.revoked) {
    return fail('revoked_token', 401, 'CT-CVE service token is revoked.')
  }
  if (!token.scopes.includes(options.requiredScope)) {
    return fail('insufficient_scope', 403, 'CT-CVE service token is not allowed to perform this action.')
  }
  if (token.orgId !== options.orgId) {
    return fail('org_scope_mismatch', 403, 'CT-CVE service token is not scoped to the requested organisation.')
  }

  const timestamp = getHeader(options.headers, 'x-ct-timestamp')
  const nonce = getHeader(options.headers, 'x-ct-nonce')
  const contentHash = getHeader(options.headers, 'x-ct-content-sha256')
  const signatureHeader = getHeader(options.headers, 'x-ct-signature')
  if (!timestamp || !nonce || !contentHash || !signatureHeader) {
    return fail('missing_header', 401, 'Missing required CT-CVE service signature header.')
  }

  const requestTime = new Date(timestamp)
  if (Number.isNaN(requestTime.getTime())) {
    return fail('invalid_timestamp', 401, 'CT-CVE service timestamp is invalid.')
  }

  const now = options.now ?? new Date()
  if (Math.abs(now.getTime() - requestTime.getTime()) > MAX_CLOCK_SKEW_MS) {
    return fail('timestamp_out_of_range', 401, 'CT-CVE service timestamp is outside the allowed replay window.')
  }

  if (!HEX_SHA256_RE.test(contentHash) || !safeEqual(contentHash, bodySha256(options.body))) {
    return fail('content_hash_mismatch', 401, 'CT-CVE service content hash does not match the request body.')
  }

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return fail('invalid_signature', 401, 'CT-CVE service signature could not be verified.')
  }

  const actualSignature = signatureHeader.slice(SIGNATURE_PREFIX.length)
  const expectedSignature = createHmac('sha256', token.secret)
    .update(signatureInput({
      method: options.method,
      path: options.path,
      timestamp,
      nonce,
      bodyHash: contentHash,
    }))
    .digest('base64url')

  if (!safeEqual(actualSignature, expectedSignature)) {
    return fail('invalid_signature', 401, 'CT-CVE service signature could not be verified.')
  }

  const nonceStore = options.nonceStore ?? ctCveNonceStore
  const remembered = await nonceStore.remember(token.id, nonce, new Date(now.getTime() + NONCE_TTL_MS), now)
  if (!remembered) {
    return fail('replayed_nonce', 401, 'CT-CVE service nonce has already been used.')
  }

  return { ok: true, token }
}

export function parseCtCveServiceTokens(input: string | undefined): CtCveServiceToken[] {
  if (!input?.trim()) {
    return []
  }

  const parsed = JSON.parse(input) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('CT_CVE_SERVICE_TOKENS must be a JSON array')
  }

  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`CT_CVE_SERVICE_TOKENS[${index}] must be an object`)
    }

    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const secret = typeof record.secret === 'string' ? record.secret : ''
    const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
    const scopes = Array.isArray(record.scopes)
      ? record.scopes.filter((scope): scope is CtCveServiceTokenScope => (
          scope === 'findings:write' || scope === 'inventory:write' || scope === 'connection:read'
        ))
      : []

    if (!id || !orgId || scopes.length === 0) {
      throw new Error(`CT_CVE_SERVICE_TOKENS[${index}] is missing id, orgId, or scopes`)
    }
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error(`CT_CVE_SERVICE_TOKENS[${index}] secret must contain at least 32 bytes of entropy`)
    }

    return {
      id,
      secret,
      orgId,
      scopes,
      revoked: record.revoked === true,
    }
  })
}

export function getConfiguredCtCveServiceTokens(): CtCveServiceToken[] {
  return parseCtCveServiceTokens(process.env.CT_CVE_SERVICE_TOKENS)
}
