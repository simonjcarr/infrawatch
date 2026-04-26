const DEFAULT_AUTH_URL = 'http://localhost:3000'

type EnvLike = Record<string, string | undefined>

function normaliseOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function getTrustedOrigins(env: EnvLike = process.env): string[] {
  const configured = [
    env['BETTER_AUTH_URL'] ?? DEFAULT_AUTH_URL,
    ...(env['BETTER_AUTH_TRUSTED_ORIGINS']
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []),
  ]

  return Array.from(
    new Set(
      configured
        .map(normaliseOrigin)
        .filter((value): value is string => value !== null),
    ),
  )
}

export function getTrustedOriginHosts(env: EnvLike = process.env): string[] {
  return Array.from(
    new Set(
      getTrustedOrigins(env)
        .map((origin) => new URL(origin).host),
    ),
  )
}

export function isTrustedMutationOrigin(
  headerSource: Headers | Pick<Headers, 'get'>,
  env: EnvLike = process.env,
): boolean {
  const trustedOrigins = new Set(getTrustedOrigins(env))
  const origin = headerSource.get('origin')
  const referer = headerSource.get('referer')

  if (origin) {
    return trustedOrigins.has(origin)
  }

  if (!referer) {
    return false
  }

  try {
    return trustedOrigins.has(new URL(referer).origin)
  } catch {
    return false
  }
}

export function assertTrustedMutationOrigin(
  headerSource: Headers | Pick<Headers, 'get'>,
  env: EnvLike = process.env,
): void {
  if (!isTrustedMutationOrigin(headerSource, env)) {
    throw new Error('forbidden: invalid request origin')
  }
}
