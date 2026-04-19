// Typed, throw-on-missing accessor for env vars.
// Import `env` anywhere in server code; the first access validates presence.
// Client code should use NEXT_PUBLIC_* vars directly.

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined
}

function optionalBool(name: string, defaultValue = false): boolean {
  const v = process.env[name]
  if (v === undefined) return defaultValue
  return v === 'true' || v === '1'
}

function optionalInt(name: string, defaultValue: number): number {
  const v = process.env[name]
  if (!v) return defaultValue
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : defaultValue
}

export const env = {
  get appUrl() {
    return optional('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3001'
  },
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get betterAuthSecret() {
    return required('BETTER_AUTH_SECRET')
  },
  get betterAuthUrl() {
    return optional('BETTER_AUTH_URL') ?? 'http://localhost:3001'
  },

  // ── Stripe ────────────────────────────────────────────────────────────────
  get stripeSecretKey() {
    return required('STRIPE_SECRET_KEY')
  },
  get stripePublishableKey() {
    return required('STRIPE_PUBLISHABLE_KEY')
  },
  get stripeWebhookSecret() {
    return required('STRIPE_WEBHOOK_SECRET')
  },
  get stripePaymentMethods(): string[] {
    return (optional('STRIPE_PAYMENT_METHODS') ?? 'card').split(',').map((s) => s.trim())
  },
  get stripeInvoiceCollectionDays() {
    return optionalInt('STRIPE_INVOICE_COLLECTION_DAYS', 14)
  },
  get stripeTaxEnabled() {
    return optionalBool('STRIPE_TAX_ENABLED', false)
  },

  // ── Licence signing ───────────────────────────────────────────────────────
  get licenceSigningPem() {
    return optional('LICENCE_SIGNING_PRIVATE_KEY_PEM')
  },
  get licenceSigningPath() {
    return optional('LICENCE_SIGNING_PRIVATE_KEY_PATH')
  },
  get licenceIssuer() {
    return optional('LICENCE_ISSUER') ?? 'licence.infrawatch.io'
  },
  get licenceAudience() {
    return optional('LICENCE_AUDIENCE') ?? 'install.infrawatch.io'
  },
  get licenceMonthlyDays() {
    return optionalInt('LICENCE_MONTHLY_DAYS', 35)
  },
  get licenceYearlyDays() {
    return optionalInt('LICENCE_YEARLY_DAYS', 375)
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  get smtp() {
    return {
      host: optional('SMTP_HOST') ?? '',
      port: optionalInt('SMTP_PORT', 587),
      secure: optionalBool('SMTP_SECURE', false),
      user: optional('SMTP_USER') ?? '',
      password: optional('SMTP_PASSWORD') ?? '',
      fromAddress: optional('SMTP_FROM_ADDRESS') ?? 'no-reply@infrawatch.io',
      fromName: optional('SMTP_FROM_NAME') ?? 'Infrawatch Licensing',
    }
  },
  get opsNotificationEmail() {
    return optional('OPS_NOTIFICATION_EMAIL')
  },

  // ── Public links ──────────────────────────────────────────────────────────
  get supportEmail() {
    return optional('SUPPORT_EMAIL') ?? 'support@infrawatch.io'
  },
  get termsUrl() {
    return optional('TERMS_URL') ?? '#'
  },
  get privacyUrl() {
    return optional('PRIVACY_URL') ?? '#'
  },
}
