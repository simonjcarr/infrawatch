/**
 * The agent version this server release requires.
 *
 * When cutting a new agent release:
 *   1. Update this constant to match the new tag (e.g. "v0.2.0")
 *   2. Push — GitHub Actions builds the binaries and attaches them to the
 *      "agent/v0.2.0" release
 *   3. On next server startup, cache-prewarm downloads the new binaries
 *      automatically — no manual steps needed
 *
 * Format must match the GitHub release tag without the "agent/" prefix.
 */
export const REQUIRED_AGENT_VERSION = 'v0.9.0'
