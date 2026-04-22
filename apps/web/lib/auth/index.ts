import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  plugins: [
    twoFactor({
      issuer: 'CT-Ops',
      totpOptions: {
        period: 30,
        digits: 6,
      },
    }),
  ],
  trustedOrigins: Array.from(
    new Set([
      process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',
      ...(process.env['BETTER_AUTH_TRUSTED_ORIGINS']
        ?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? []),
    ]),
  ),
  secret: process.env['BETTER_AUTH_SECRET'] ?? '',
  baseURL: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',
})

export type Auth = typeof auth
