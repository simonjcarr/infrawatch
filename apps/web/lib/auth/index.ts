import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { sendVerificationEmail } from './email'
import { getBetterAuthOrigin, getBetterAuthSecret, getBetterAuthUrl } from './env'
import { passwordLoginAttemptGuard } from './login-attempts'

const LOGIN_THROTTLED_MESSAGE = 'Too many login attempts — please wait before trying again.'

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
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({
        email: user.email,
        name: user.name,
        verificationUrl: url,
      })
    },
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
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return

      const email = typeof ctx.body?.email === 'string' ? ctx.body.email : ''
      const status = passwordLoginAttemptGuard.check(email)
      if (status.allowed) return

      throw new APIError('TOO_MANY_REQUESTS', {
        message: LOGIN_THROTTLED_MESSAGE,
      })
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return
      if (typeof ctx.body?.email !== 'string' || typeof ctx.body?.password !== 'string') return

      if (ctx.context.newSession) {
        passwordLoginAttemptGuard.reset(ctx.body.email)
        return
      }

      passwordLoginAttemptGuard.recordFailure(ctx.body.email)
    }),
  },
  trustedOrigins: Array.from(
    new Set([
      getBetterAuthOrigin(),
      ...(process.env['BETTER_AUTH_TRUSTED_ORIGINS']
        ?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? []),
    ]),
  ),
  secret: getBetterAuthSecret(),
  baseURL: getBetterAuthUrl(),
})

export type Auth = typeof auth
