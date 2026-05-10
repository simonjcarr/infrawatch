import { createPrivateKey, randomUUID, type KeyObject } from 'node:crypto'
import { SignJWT } from 'jose'

type EnvLike = Record<string, string | undefined>

export const PASSWORD_MANAGER_LAUNCH_ASSERTION_TTL_SECONDS = 60

const DEFAULT_PASSWORD_MANAGER_AUDIENCE = 'ct-password-manager'
const DEFAULT_PASSWORD_MANAGER_PRODUCT = 'ct-password-manager'

export interface PasswordManagerLaunchAssertionConfig {
  issuer: string
  audience: string
  product: string
  ctOpsInstanceId: string
  ttlSeconds: number
  privateKey: KeyObject
}

export interface PasswordManagerLaunchPrincipal {
  instanceId: string
  instanceName?: string | null
  userId: string
  email: string
  name: string
}

function readRequiredString(
  env: EnvLike,
  primaryKey: string,
  fallbackKey?: string,
): string {
  const primaryValue = env[primaryKey]?.trim()
  if (primaryValue) {
    return primaryValue
  }

  if (fallbackKey) {
    const fallbackValue = env[fallbackKey]?.trim()
    if (fallbackValue) {
      return fallbackValue
    }
    throw new Error(`${primaryKey} or ${fallbackKey} must be set`)
  }

  throw new Error(`${primaryKey} must be set`)
}

function readOptionalString(env: EnvLike, key: string, fallback: string): string {
  return env[key]?.trim() || fallback
}

function parsePrivateKey(base64Der: string): KeyObject {
  let der: Buffer
  try {
    der = Buffer.from(base64Der, 'base64')
  } catch {
    throw new Error('PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY must be valid base64 DER')
  }

  if (der.length === 0) {
    throw new Error('PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY must be set')
  }

  try {
    return createPrivateKey({
      key: der,
      format: 'der',
      type: 'pkcs8',
    })
  } catch {
    throw new Error('PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY must be a valid Ed25519 PKCS#8 DER key')
  }
}

function assertNonEmptyPrincipalField(value: string | null | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${field} must be set`)
  }
  return trimmed
}

export function getPasswordManagerLaunchAssertionConfig(
  env: EnvLike = process.env,
): PasswordManagerLaunchAssertionConfig {
  return {
    issuer: readRequiredString(env, 'PASSWORD_MANAGER_CT_OPS_ISSUER', 'BETTER_AUTH_URL'),
    audience: readOptionalString(env, 'PASSWORD_MANAGER_CT_OPS_AUDIENCE', DEFAULT_PASSWORD_MANAGER_AUDIENCE),
    product: readOptionalString(env, 'PASSWORD_MANAGER_CT_OPS_PRODUCT', DEFAULT_PASSWORD_MANAGER_PRODUCT),
    ctOpsInstanceId: readRequiredString(env, 'CT_OPS_INSTANCE_ID'),
    ttlSeconds: PASSWORD_MANAGER_LAUNCH_ASSERTION_TTL_SECONDS,
    privateKey: parsePrivateKey(
      readRequiredString(env, 'PASSWORD_MANAGER_CT_OPS_ED25519_PRIVATE_KEY'),
    ),
  }
}

export async function signPasswordManagerLaunchAssertion(
  principal: PasswordManagerLaunchPrincipal,
  options: {
    config?: PasswordManagerLaunchAssertionConfig
    now?: Date
    jti?: string
  } = {},
): Promise<string> {
  const config = options.config ?? getPasswordManagerLaunchAssertionConfig()
  const now = options.now ?? new Date()
  const issuedAt = Math.floor(now.getTime() / 1000)
  const jti = options.jti ?? randomUUID()

  const payload: Record<string, string> = {
    product: config.product,
    ct_ops_instance_id: config.ctOpsInstanceId,
    ct_ops_organization_id: assertNonEmptyPrincipalField(principal.instanceId, 'instanceId'),
    ct_ops_user_id: assertNonEmptyPrincipalField(principal.userId, 'userId'),
    email: assertNonEmptyPrincipalField(principal.email, 'email'),
    name: assertNonEmptyPrincipalField(principal.name, 'name'),
  }

  const instanceName = principal.instanceName?.trim()
  if (instanceName) {
    payload.ct_ops_organization_name = instanceName
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.ttlSeconds)
    .setJti(jti)
    .sign(config.privateKey)
}
