type EnvLike = Record<string, string | undefined>

function normaliseAbsoluteOrigin(name: string, value: string): string {
  try {
    return new URL(value).origin
  } catch {
    throw new Error(`${name} must be a valid absolute URL`)
  }
}

export function getAgentPublicOrigin(env: EnvLike = process.env): string {
  const downloadBaseUrl = env['AGENT_DOWNLOAD_BASE_URL']?.trim()
  if (downloadBaseUrl) {
    return normaliseAbsoluteOrigin('AGENT_DOWNLOAD_BASE_URL', downloadBaseUrl)
  }

  const betterAuthUrl = env['BETTER_AUTH_URL']?.trim()
  if (betterAuthUrl) {
    return normaliseAbsoluteOrigin('BETTER_AUTH_URL', betterAuthUrl)
  }

  throw new Error('AGENT_DOWNLOAD_BASE_URL or BETTER_AUTH_URL must be set')
}
