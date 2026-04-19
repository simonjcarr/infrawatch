import { readFile } from 'node:fs/promises'
import { importPKCS8, SignJWT } from 'jose'
import { env } from '@/lib/env'

export type SignLicenceInput = {
  // The install's organisation id, captured from the activation token. Used
  // as the JWT `sub` claim so apps/web can verify the licence was minted for
  // this specific install and reject it if pasted into a different install.
  installOrganisationId: string
  customer: { name: string; email: string }
  productSlug: string
  tier: string
  features: string[]
  jti: string
  issuedAt: Date
  expiresAt: Date
}

export type SignedLicence = {
  jwt: string
  jti: string
  expiresAt: Date
}

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>

let cachedKey: Promise<SigningKey> | null = null

async function loadSigningKey(): Promise<SigningKey> {
  if (cachedKey) return cachedKey
  cachedKey = (async (): Promise<SigningKey> => {
    const inlinePem = env.licenceSigningPem
    const pem = inlinePem ?? (env.licenceSigningPath ? await readFile(env.licenceSigningPath, 'utf8') : undefined)
    if (!pem) {
      throw new Error(
        'Licence signing key is not configured: set LICENCE_SIGNING_PRIVATE_KEY_PEM or LICENCE_SIGNING_PRIVATE_KEY_PATH',
      )
    }
    return importPKCS8(pem.trim(), 'RS256')
  })()
  try {
    return await cachedKey
  } catch (err) {
    cachedKey = null
    throw err
  }
}

export async function signLicence(input: SignLicenceInput): Promise<SignedLicence> {
  const key = await loadSigningKey()

  const claims: Record<string, unknown> = {
    product_slug: input.productSlug,
    tier: input.tier,
    features: input.features,
    customer: input.customer,
  }

  const iat = Math.floor(input.issuedAt.getTime() / 1000)
  const exp = Math.floor(input.expiresAt.getTime() / 1000)

  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.licenceIssuer)
    .setAudience(env.licenceAudience)
    .setSubject(input.installOrganisationId)
    .setJti(input.jti)
    .setIssuedAt(iat)
    .setNotBefore(iat)
    .setExpirationTime(exp)
    .sign(key)

  return {
    jwt,
    jti: input.jti,
    expiresAt: input.expiresAt,
  }
}
