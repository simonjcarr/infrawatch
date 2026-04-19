// Activation token — an unsigned, URL-safe handle the customer copies from
// their Infrawatch install and pastes into the licence-purchase checkout. It
// tells the licence-purchase service *which* install the licence must be
// minted for, so the resulting JWT carries that install's organisation id as
// the `sub` claim and can't be reused on another install.
//
// Phase 1: the token is just a base64url-encoded JSON blob. It's not signed,
// because a malicious customer pasting their own install's id gains nothing —
// they can only bind a licence they paid for to an install they already own.
//
// Phase 2 will upgrade this to a signed challenge-response flow so a cloned
// database can't mint new install identities.

const TOKEN_PREFIX = 'infw-act_'
const TOKEN_VERSION = 1
const MAX_TOKEN_AGE_DAYS = 30

export type ActivationTokenPayload = {
  v: number
  installOrgId: string
  installOrgName: string
  generatedAt: string
  nonce: string
}

export type ActivationTokenDecodeResult =
  | { ok: true; payload: ActivationTokenPayload }
  | { ok: false; error: string }

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64').toString('utf8')
}

export function encodeActivationToken(
  input: Omit<ActivationTokenPayload, 'v' | 'generatedAt'> & { generatedAt?: Date },
): string {
  const payload: ActivationTokenPayload = {
    v: TOKEN_VERSION,
    installOrgId: input.installOrgId,
    installOrgName: input.installOrgName,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    nonce: input.nonce,
  }
  return TOKEN_PREFIX + toBase64Url(JSON.stringify(payload))
}

export function decodeActivationToken(raw: string): ActivationTokenDecodeResult {
  const trimmed = raw.trim()
  if (!trimmed.startsWith(TOKEN_PREFIX)) {
    return { ok: false, error: 'Token is not a valid activation token' }
  }
  const body = trimmed.slice(TOKEN_PREFIX.length)
  if (!body) {
    return { ok: false, error: 'Activation token is empty' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(body))
  } catch {
    return { ok: false, error: 'Activation token is malformed' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Activation token is malformed' }
  }
  const p = parsed as Record<string, unknown>

  if (p.v !== TOKEN_VERSION) {
    return { ok: false, error: `Unsupported activation token version: ${String(p.v)}` }
  }
  if (typeof p.installOrgId !== 'string' || !p.installOrgId) {
    return { ok: false, error: 'Activation token is missing installOrgId' }
  }
  if (typeof p.installOrgName !== 'string' || !p.installOrgName) {
    return { ok: false, error: 'Activation token is missing installOrgName' }
  }
  if (typeof p.generatedAt !== 'string' || !p.generatedAt) {
    return { ok: false, error: 'Activation token is missing generatedAt' }
  }
  if (typeof p.nonce !== 'string' || !p.nonce) {
    return { ok: false, error: 'Activation token is missing nonce' }
  }

  const generatedAt = new Date(p.generatedAt)
  if (Number.isNaN(generatedAt.getTime())) {
    return { ok: false, error: 'Activation token has an invalid timestamp' }
  }
  const ageDays = (Date.now() - generatedAt.getTime()) / (24 * 60 * 60 * 1000)
  if (ageDays > MAX_TOKEN_AGE_DAYS) {
    return { ok: false, error: 'Activation token has expired — generate a new one' }
  }
  if (generatedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return { ok: false, error: 'Activation token is dated in the future' }
  }

  return {
    ok: true,
    payload: {
      v: TOKEN_VERSION,
      installOrgId: p.installOrgId,
      installOrgName: p.installOrgName,
      generatedAt: p.generatedAt,
      nonce: p.nonce,
    },
  }
}
