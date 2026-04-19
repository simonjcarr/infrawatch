import { importSPKI, jwtVerify } from 'jose'
import type { Feature, LicenceTier } from './features'

// Production public key (RS256) — used to verify licence JWTs issued by the
// official infrawatch.io licence-purchase service. The matching private key
// lives only on the licence-purchase server (deploy/scripts/licence-prod-private.pem
// during MVP, KMS / Vault Transit before customer launch).
//
// Rotating this key is a breaking change requiring every customer to upgrade
// the binary. Treat it as a release-signing key — back up the private half in
// multiple secure locations and never amend it casually.
const PROD_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs7wCpDYBtABdwlkDe5Vq
ATSc3vjvPMvRZouJrvsg/DxWTUMYbvVvhaICXZjgDDl7ztrIS+jvM4SfGfrArQpu
CxrmYRYITpZ8t71XDccmIKxBypxVupFtm1JiF6oLIWknKcLV4g2SLvep5YQLhSQq
ebJdEjJtGbao9oWdLfDhnmKjSGTwGjX6jJysGhGWm0YpTNaGPZ81OcvlBHweTX34
g/In9Js5u7oieD3+aY6JKMF65tnnswRS8Psj5UHtOeAc7GOR193EVEczgEQ95o37
Uol9h/Lzyomiz808xOIWvemZLeT3DzeeNDcT4GOpKt8aIr+CQ8nsZk9wggd6aWnk
XwIDAQAB
-----END PUBLIC KEY-----`

// Development public key — only used when NODE_ENV !== 'production'. The
// matching private key lives at deploy/scripts/licence-dev-private.pem
// (gitignored) and is used for local end-to-end iteration on the licence
// issuance flow without exposing the production private key.
const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz/pW3tGLo8e//f75eVk3
pNM/S9CPBYozjgSRDxppJQIr2JPTI4tM9jd4Of1i0/MYfighpTSilDtUGgI6Q6Z9
8hs5aBFT/N63BanMwsAlqGHRZ/igJSWu5HhBuWR2CtKIpIqGcel32uAyGDnTjfKu
iYswa0tn+/Q2KxX7HF6aoNAH0CH333sa88QxNCRCKvj/Byqqdma/VTp7Gj50JdSP
YvAIzi0rDcPBMRFMGm6M7n6lwN/XCPgdXEAzI2z+/PiBAK3suh3jyaxtD0D4FHdt
/Iyxxs/zZsceZIpjDcyVbd1JJ6Y3DumbgAPqajnMNSVkniYWG7Q37DfsYNtk6/DT
EQIDAQAB
-----END PUBLIC KEY-----`

export function resolveLicencePublicKeyPem(): string {
  if (process.env.NODE_ENV === 'production') {
    return PROD_PUBLIC_KEY_PEM.trim()
  }
  return DEV_PUBLIC_KEY_PEM.trim()
}

const LICENCE_ISSUER = 'licence.infrawatch.io'
const LICENCE_AUDIENCE = 'install.infrawatch.io'

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
