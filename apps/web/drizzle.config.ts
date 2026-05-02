import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { getDatabaseUrl } from './lib/db/connection-string.ts'

config({ path: '.env.local' })

export default defineConfig({
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
  verbose: true,
  strict: true,
})
