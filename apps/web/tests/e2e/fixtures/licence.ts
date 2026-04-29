import { SignJWT, importPKCS8 } from 'jose'
import { createId } from '@paralleldrive/cuid2'

type TestLicenceOptions = {
  orgId: string
  tier?: 'pro' | 'enterprise'
  features?: string[]
  maxUsers?: number
  maxHosts?: number
}

const LICENCE_ISSUER = 'licence.carrtech.dev'
const LICENCE_AUDIENCE = 'install.carrtech.dev'

export async function issueTestLicence({
  orgId,
  tier = 'pro',
  features = [],
  maxUsers = 10,
  maxHosts = 100,
}: TestLicenceOptions): Promise<string> {
  const privateKeyPem = process.env['E2E_LICENCE_PRIVATE_KEY']
  if (!privateKeyPem) {
    throw new Error('E2E_LICENCE_PRIVATE_KEY is not set')
  }

  const privateKey = await importPKCS8(privateKeyPem, 'RS256')
  return new SignJWT({
    tier,
    features,
    maxUsers,
    maxHosts,
    customer: {
      name: 'E2E Test Customer',
      email: 'billing@example.com',
    },
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(LICENCE_ISSUER)
    .setAudience(LICENCE_AUDIENCE)
    .setSubject(orgId)
    .setJti(createId())
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('2h')
    .sign(privateKey)
}
