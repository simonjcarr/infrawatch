import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { and, count, eq, isNull } from 'drizzle-orm'
import { authDb, db } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { parseInstanceMetadata } from '@/lib/db/schema/instance-settings'
import {
  getAuthEmailConfigFromInstanceSettings,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './email'
import { getDefaultInstanceId } from '@/lib/default-instance'
import {
  getBetterAuthOrigin,
  getBetterAuthSecret,
  getBetterAuthUrl,
  getRequireEmailVerification,
} from './env'
import {
  EMAIL_VERIFICATION_RESEND_THROTTLED_MESSAGE,
  emailVerificationResendPolicy,
} from './email-verification-rate-limit'
import { getVerificationResendClientIp } from './email-verification-resend'
import { passwordLoginAttemptGuard } from './login-attempts'
import { getDirectSignupProvisioning, isInviteSignupCallback } from './signup-provisioning'

const LOGIN_THROTTLED_MESSAGE = 'Too many login attempts — please wait before trying again.'
const requireEmailVerification = getRequireEmailVerification()

async function getAuthEmailConfigForUser(userId: string) {
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
    columns: { instanceId: true },
  })
  const instanceId = user?.instanceId ?? await getDefaultInstanceId()
  if (!instanceId) return null

  const instance = await db.query.instanceSettings.findFirst({
    where: (instanceSettingsTable, { eq }) => eq(instanceSettingsTable.id, instanceId),
    columns: { metadata: true },
  })
  if (!instance) return null

  const metadata = parseInstanceMetadata(instance.metadata)
  return getAuthEmailConfigFromInstanceSettings(metadata.notificationSettings)
}

export const auth = betterAuth({
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      totpCredentials: schema.totpCredentials,
    },
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (isInviteSignupCallback(ctx?.body?.callbackURL)) {
            return { data: user }
          }

          const [activeUsersRow, defaultInstanceId] = await Promise.all([
            db
              .select({ total: count() })
              .from(schema.users)
              .where(and(eq(schema.users.isActive, true), isNull(schema.users.deletedAt))),
            getDefaultInstanceId(),
          ])
          const activeUserCount = activeUsersRow[0]?.total ?? 0

          return {
            data: {
              ...user,
              ...getDirectSignupProvisioning({ defaultInstanceId, activeUserCount }),
            },
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url, token }) => {
      const appResetUrl = new URL(`/reset-password/${token}`, getBetterAuthOrigin())
      const callbackURL = new URL(url).searchParams.get('callbackURL')
      const smtpConfig = await getAuthEmailConfigForUser(user.id)
      if (callbackURL) {
        appResetUrl.searchParams.set('callbackURL', callbackURL)
      }

      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetUrl: appResetUrl.toString(),
        smtpConfig,
      })
    },
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const smtpConfig = await getAuthEmailConfigForUser(user.id)
      await sendVerificationEmail({
        email: user.email,
        name: user.name,
        verificationUrl: url,
        smtpConfig,
      })
    },
  },
  plugins: [
    twoFactor({
      issuer: 'CT-Ops',
      twoFactorTable: 'totpCredentials',
      schema: {
        twoFactor: {
          modelName: 'totpCredentials',
          fields: {
            backupCodes: 'backupCodes',
            userId: 'userId',
          },
        },
      },
      totpOptions: {
        period: 30,
        digits: 6,
      },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/send-verification-email') {
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email : ''
        const request = ctx.request
        const ip = request ? getVerificationResendClientIp(request) : 'unknown'
        if (!await emailVerificationResendPolicy.check({ email, ip })) {
          throw new APIError('TOO_MANY_REQUESTS', {
            message: EMAIL_VERIFICATION_RESEND_THROTTLED_MESSAGE,
          })
        }

        throw new APIError('FORBIDDEN', {
          message: 'Verification email resend requires password confirmation.',
        })
      }

      if (ctx.path !== '/sign-in/email') return

      const email = typeof ctx.body?.email === 'string' ? ctx.body.email : ''
      const status = await passwordLoginAttemptGuard.check(email)
      if (status.allowed) return

      throw new APIError('TOO_MANY_REQUESTS', {
        message: LOGIN_THROTTLED_MESSAGE,
      })
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return
      if (typeof ctx.body?.email !== 'string' || typeof ctx.body?.password !== 'string') return

      if (ctx.context.newSession) {
        await passwordLoginAttemptGuard.reset(ctx.body.email)
        return
      }

      await passwordLoginAttemptGuard.recordFailure(ctx.body.email)
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
