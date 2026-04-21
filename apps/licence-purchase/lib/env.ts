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

  // ── Support portal / AI ───────────────────────────────────────────────────
  get anthropicApiKey() {
    return optional('ANTHROPIC_API_KEY')
  },
  get supportAiKillSwitch() {
    return optionalBool('SUPPORT_AI_KILL_SWITCH', false)
  },
  get supportAiModelId() {
    return optional('SUPPORT_AI_MODEL_ID') ?? 'claude-sonnet-4-6'
  },
  get supportAiModerationModelId() {
    return optional('SUPPORT_AI_MODERATION_MODEL_ID') ?? 'claude-haiku-4-5'
  },
  get supportGithubRepo() {
    return optional('SUPPORT_GITHUB_REPO') ?? 'carrtech-dev/ct-ops'
  },
  get supportGithubReadonlyToken() {
    return optional('GITHUB_SUPPORT_READONLY_TOKEN')
  },
  get supportGithubRepoBlocklist(): string[] {
    const raw = optional('SUPPORT_GITHUB_REPO_BLOCKLIST')
    if (!raw) return []
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  },
  get supportAiMaxResponsesPerHour() {
    return optionalInt('SUPPORT_AI_MAX_RESPONSES_PER_HOUR', 10)
  },
  get supportWorkerPollMs() {
    return optionalInt('SUPPORT_WORKER_POLL_MS', 2000)
  },
  get supportUploadDir() {
    return optional('SUPPORT_UPLOAD_DIR') ?? './support-uploads'
  },
  // Max size per uploaded file in bytes (default 10 MB).
  get supportUploadMaxBytes() {
    return optionalInt('SUPPORT_UPLOAD_MAX_BYTES', 10 * 1024 * 1024)
  },
  // Max number of attachments per message.
  get supportUploadMaxFiles() {
    return optionalInt('SUPPORT_UPLOAD_MAX_FILES', 5)
  },

  // ── Cloudflare R2 (optional — if set, attachments are stored in R2) ───────
  get r2AccountId() {
    return optional('R2_ACCOUNT_ID')
  },
  get r2AccessKeyId() {
    return optional('R2_ACCESS_KEY_ID')
  },
  get r2SecretAccessKey() {
    return optional('R2_SECRET_ACCESS_KEY')
  },
  get r2BucketName() {
    return optional('R2_BUCKET_NAME')
  },
  // Presigned URL expiry in seconds (default 1 hour).
  get r2PresignedUrlExpirySecs() {
    return optionalInt('R2_PRESIGNED_URL_EXPIRY_SECS', 3600)
  },
  // Returns true when all four required R2 vars are set.
  get r2Enabled(): boolean {
    return !!(this.r2AccountId && this.r2AccessKeyId && this.r2SecretAccessKey && this.r2BucketName)
  },
}
