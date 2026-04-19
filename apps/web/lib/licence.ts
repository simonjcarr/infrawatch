import { importSPKI, jwtVerify } from 'jose'
import type { Feature, LicenceTier } from './features'

// Dev-only public key (RS256) — used in development when LICENCE_PUBLIC_KEY is not set.
// In production, set LICENCE_PUBLIC_KEY to your RSA public key PEM.
// The matching private key lives in deploy/scripts/licence-dev-private.pem (never commit).
const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5Wep87Fxy2SUYnx8MLx2
oVWA94ygeDMKfRQWm16Vdvc+fzpTQettcbMQN6AMe/SzFk0oipzs2wB//9DyoFhK
Aj2C2rsmuRlgFv8hcdHrfFKRw416pJTzmMNeu+Qc+shXw76lvOjnFRkEc/KKchcX
CdPM3h3rYVbjBpZEkgbbxqRnG9wbBF4/eEtQthkEilIPYf3O+zWaUxwpMyLuykr7
OcVgn3vrZ0RfExrMhelwZvgDoutHol9KhoqCQkSLxaL2eMC9NzYtCuESLCYOEiIS
q6YFpCA6PtWXuwKYMfj9egw/d2KePf5YiBEBZJzLu1L57Fouf1fVWc7hr32BrL9N
wQIDAQAB
-----END PUBLIC KEY-----`

/**
 * Returns the RSA public key PEM to use for licence JWT verification.
 *
 * Resolution order:
 *   1. LICENCE_PUBLIC_KEY env var (always preferred)
 *   2. Dev key — only allowed when NODE_ENV !== 'production'
 *
 * Throws at startup in production if the env var is absent or still set to
 * the development key, so misconfigured deployments fail fast rather than
 * silently accepting forged licences.
 */
export function resolveLicencePublicKeyPem(): string {
  const envKey = process.env.LICENCE_PUBLIC_KEY?.trim()

  if (envKey) {
    if (process.env.NODE_ENV === 'production' && envKey === DEV_PUBLIC_KEY_PEM.trim()) {
      throw new Error(
        'LICENCE_PUBLIC_KEY is set to the development key. ' +
          'Set it to your production RSA public key PEM before deploying.',
      )
    }
    return envKey
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'LICENCE_PUBLIC_KEY environment variable is required in production. ' +
        'Set it to your RSA public key PEM (see docs/getting-started/configuration.md).',
    )
  }

  return DEV_PUBLIC_KEY_PEM.trim()
}

const LICENCE_ISSUER = 'infrawatch-licensing'
const LICENCE_AUDIENCE = 'infrawatch'

export type PaidTier = Exclude<LicenceTier, 'community'>

export type LicenceCustomer = {
  name: string
  email: string
}

export type LicencePayload = {
  iss: string
  sub: string
  aud: string
  iat: number
  nbf: number
  exp: number
  jti: string
  tier: PaidTier
  features: Feature[]
  maxHosts?: number
  customer: LicenceCustomer
}

export type LicenceValidationResult =
  | { valid: true; payload: LicencePayload }
  | { valid: false; error: string }

function isPaidTier(v: unknown): v is PaidTier {
  return v === 'pro' || v === 'enterprise'
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string')
}

function isCustomer(v: unknown): v is LicenceCustomer {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.name === 'string' && typeof c.email === 'string'
}

export async function validateLicenceKey(key: string): Promise<LicenceValidationResult> {
  try {
    const publicKey = await importSPKI(resolveLicencePublicKeyPem(), 'RS256')
    const { payload } = await jwtVerify(key, publicKey, {
      algorithms: ['RS256'],
      issuer: LICENCE_ISSUER,
      audience: LICENCE_AUDIENCE,
    })

    if (!isPaidTier(payload['tier'])) {
      return { valid: false, error: 'Invalid licence tier in key' }
    }
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return { valid: false, error: 'Licence key is missing organisation field' }
    }
    if (typeof payload.jti !== 'string' || !payload.jti) {
      return { valid: false, error: 'Licence key is missing a licence id' }
    }
    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      return { valid: false, error: 'Licence key has invalid timestamps' }
    }

    const rawFeatures = payload['features']
    const features: Feature[] = isStringArray(rawFeatures) ? (rawFeatures as Feature[]) : []

    const rawCustomer = payload['customer']
    if (!isCustomer(rawCustomer)) {
      return { valid: false, error: 'Licence key is missing customer details' }
    }

    const rawMaxHosts = payload['maxHosts']
    const maxHosts = typeof rawMaxHosts === 'number' && rawMaxHosts > 0 ? rawMaxHosts : undefined

    return {
      valid: true,
      payload: {
        iss: LICENCE_ISSUER,
        aud: LICENCE_AUDIENCE,
        sub: payload.sub,
        iat: payload.iat,
        nbf: typeof payload.nbf === 'number' ? payload.nbf : payload.iat,
        exp: payload.exp,
        jti: payload.jti,
        tier: payload['tier'],
        features,
        maxHosts,
        customer: rawCustomer,
      },
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('expired')) {
        return { valid: false, error: 'Licence key has expired' }
      }
      if (err.message.includes('signature')) {
        return { valid: false, error: 'Licence key signature is invalid' }
      }
      if (err.message.includes('iss')) {
        return { valid: false, error: 'Licence key issuer is invalid' }
      }
      if (err.message.includes('aud')) {
        return { valid: false, error: 'Licence key audience is invalid' }
      }
    }
    return { valid: false, error: 'Invalid licence key' }
  }
}
