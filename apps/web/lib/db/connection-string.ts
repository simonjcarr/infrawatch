type DatabaseEnv = Record<string, string | undefined>

export function getDatabaseUrl(env: DatabaseEnv = process.env): string {
  if (env['DATABASE_URL']) {
    return env['DATABASE_URL']
  }

  const user = env['POSTGRES_USER'] || 'ctops'
  const password = env['POSTGRES_PASSWORD']
  const host = env['POSTGRES_HOST'] || 'localhost'
  const port = env['POSTGRES_PORT'] || '5432'
  const database = env['POSTGRES_DB'] || 'ctops'

  if (!password) {
    throw new Error('POSTGRES_PASSWORD environment variable is required when DATABASE_URL is not set')
  }

  const url = new URL(`postgresql://${host}:${port}/${database}`)
  url.username = user
  url.password = password
  return url.toString()
}
