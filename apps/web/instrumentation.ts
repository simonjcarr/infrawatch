/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Pre-warms the agent binary cache so every platform binary is available
 * immediately, even on a fresh server or after a new release ships.
 * Also performs fail-fast validation of required environment variables so
 * misconfigurations surface at boot rather than at first use.
 */
export async function register() {
  // Only run in the Node.js runtime (not Edge), and only on the server.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Validate licence public key configuration — throws in production if missing
  // or set to the development key, preventing forged licence acceptance.
  const { resolveLicencePublicKeyPem } = await import('./lib/licence')
  resolveLicencePublicKeyPem()

  const { prewarmAgentCache } = await import('./lib/agent/cache-prewarm')
  await prewarmAgentCache()
}
