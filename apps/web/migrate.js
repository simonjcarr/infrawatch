// Runs Drizzle ORM migrations against the database.
// Uses only production dependencies (drizzle-orm + postgres) — safe to run
// inside the standalone Docker image without drizzle-kit.
//
// Usage: node migrate.js
// Requires either DATABASE_URL or POSTGRES_* environment variables.

const { drizzle } = require('drizzle-orm/postgres-js')
const { migrate } = require('drizzle-orm/postgres-js/migrator')
const postgres = require('postgres')
const path = require('path')

function getDatabaseUrl(env = process.env) {
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

async function main() {
  const connectionString = getDatabaseUrl()

  const client = postgres(connectionString, { prepare: false, max: 1 })
  const db = drizzle(client)

  console.log('Running database migrations...')
  await migrate(db, { migrationsFolder: path.join(__dirname, 'lib/db/migrations') })
  console.log('Migrations complete.')

  await client.end()
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
