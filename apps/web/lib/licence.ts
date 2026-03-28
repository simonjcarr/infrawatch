import { importSPKI, jwtVerify } from 'jose'

// Dev public key (RS256) — replace with your production signing key before release.
// The matching private key is in deploy/scripts/licence-dev-private.pem (never commit).
const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5Wep87Fxy2SUYnx8MLx2
oVWA94ygeDMKfRQWm16Vdvc+fzpTQettcbMQN6AMe/SzFk0oipzs2wB//9DyoFhK
Aj2C2rsmuRlgFv8hcdHrfFKRw416pJTzmMNeu+Qc+shXw76lvOjnFRkEc/KKchcX
CdPM3h3rYVbjBpZEkgbbxqRnG9wbBF4/eEtQthkEilIPYf3O+zWaUxwpMyLuykr7
OcVgn3vrZ0RfExrMhelwZvgDoutHol9KhoqCQkSLxaL2eMC9NzYtCuESLCYOEiIS
q6YFpCA6PtWXuwKYMfj9egw/d2KePf5YiBEBZJzLu1L57Fouf1fVWc7hr32BrL9N
wQIDAQAB
-----END PUBLIC KEY-----`

export type LicencePayload = {
  tier: 'pro' | 'enterprise'
  org: string
  exp: number
}

export async function validateLicenceKey(
  key: string,
): Promise<{ valid: true; payload: LicencePayload } | { valid: false; error: string }> {
  try {
    const publicKey = await importSPKI(DEV_PUBLIC_KEY_PEM.trim(), 'RS256')
    const { payload } = await jwtVerify(key, publicKey, { algorithms: ['RS256'] })

    if (!payload['tier'] || !['pro', 'enterprise'].includes(payload['tier'] as string)) {
      return { valid: false, error: 'Invalid licence tier in key' }
    }
    if (!payload['org']) {
      return { valid: false, error: 'Licence key is missing organisation field' }
    }

    return {
      valid: true,
      payload: {
        tier: payload['tier'] as 'pro' | 'enterprise',
        org: payload['org'] as string,
        exp: payload.exp ?? 0,
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
    }
    return { valid: false, error: 'Invalid licence key' }
  }
}
