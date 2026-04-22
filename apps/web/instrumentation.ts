/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Pre-warms the agent binary cache so every platform binary is available
 * immediately, even on a fresh server or after a new release ships.
 * Also performs fail-fast validation of required auth env vars so
 * misconfigurations surface at boot rather than at first use.
 */
export async function register() {
  // Only run in the Node.js runtime (not Edge), and only on the server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // `next build` sets NODE_ENV=production but secrets are not available at
  // build time. Skip runtime-only checks during the build phase.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // Validate critical auth env vars in production.
  // Better Auth accepts an empty secret and falls back silently, which would
  // allow session cookies to be signed with an empty key.
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.BETTER_AUTH_SECRET
    if (!secret || secret.length < 32) {
      throw new Error(
        'BETTER_AUTH_SECRET must be set to a random string of at least 32 characters in production. ' +
          'Generate one with: openssl rand -base64 32',
      )
    }
    if (!process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL === 'http://localhost:3000') {
      throw new Error(
        'BETTER_AUTH_URL must be set to the public URL of this deployment in production ' +
          '(e.g. https://ct-ops.corp.example.com).',
      )
    }
    if (!process.env.LDAP_ENCRYPTION_KEY) {
      // Not a hard failure — LDAP may not be used — but warn loudly so operators know
      // to set this before configuring LDAP. Without it, BETTER_AUTH_SECRET is used as
      // the LDAP KDF input, meaning rotating auth secrets breaks stored LDAP credentials.
      console.warn(
        '[ct-ops] LDAP_ENCRYPTION_KEY is not set. If you use LDAP, set a dedicated ' +
          '32-byte key (openssl rand -base64 32) to decouple LDAP credential encryption ' +
          'from the session signing secret.',
      )
    }
  }

  const { prewarmAgentCache } = await import('./lib/agent/cache-prewarm')
  await prewarmAgentCache()
}
