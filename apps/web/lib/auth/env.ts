type EnvLike = Record<string, string | undefined>

const PRODUCTION_BUILD_PHASE = 'phase-production-build'
const BUILD_TIME_AUTH_SECRET = 'build-time-placeholder-000000000'
const BUILD_TIME_AUTH_URL = 'https://build-time-placeholder.invalid'

function isProductionBuildPhase(env: EnvLike): boolean {
  return env['NEXT_PHASE'] === PRODUCTION_BUILD_PHASE
}

function readBooleanEnv(env: EnvLike, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase()
  if (!value) return fallback
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error(`${name} must be either true or false`)
}

function readRequiredEnv(env: EnvLike, name: 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'): string {
  const value = env[name]?.trim()
  if (value) {
    return value
  }

  if (isProductionBuildPhase(env)) {
    if (name === 'BETTER_AUTH_SECRET') return BUILD_TIME_AUTH_SECRET
    return BUILD_TIME_AUTH_URL
  }

  throw new Error(`${name} must be set`)
}

export function getBetterAuthSecret(env: EnvLike = process.env): string {
  return readRequiredEnv(env, 'BETTER_AUTH_SECRET')
}

export function getBetterAuthUrl(env: EnvLike = process.env): string {
  const value = readRequiredEnv(env, 'BETTER_AUTH_URL')

  try {
    return new URL(value).toString()
  } catch {
    throw new Error('BETTER_AUTH_URL must be a valid absolute URL')
  }
}

export function getBetterAuthOrigin(env: EnvLike = process.env): string {
  return new URL(getBetterAuthUrl(env)).origin
}

export function getRequireEmailVerification(env: EnvLike = process.env): boolean {
  return readBooleanEnv(env, 'REQUIRE_EMAIL_VERIFICATION', true)
}

export function assertProductionAuthEnv(env: EnvLike = process.env): void {
  const secret = getBetterAuthSecret(env)
  if (secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to a random string of at least 32 characters in production. ' +
        'Generate one with: openssl rand -base64 32',
    )
  }

  const url = new URL(getBetterAuthUrl(env))
  if (url.origin === 'http://localhost:3000' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    throw new Error(
      'BETTER_AUTH_URL must be set to the public URL of this deployment in production ' +
        '(e.g. https://ct-ops.corp.example.com).',
    )
  }
}
