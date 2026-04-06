import fs from 'fs'
import path from 'path'

/**
 * Reads the required agent version from .release-please-manifest.json at the
 * repo root. Release-please updates this file automatically when it cuts a
 * new agent release, so this value is always in sync with the latest release
 * without any manual intervention.
 */
function loadRequiredAgentVersion(): string {
  try {
    // Works from both the repo root (dev) and inside the Next.js container
    // (where the repo root is mounted or baked in at build time).
    const candidates = [
      path.join(process.cwd(), '.release-please-manifest.json'),
      path.join(process.cwd(), '../../.release-please-manifest.json'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, string>
        if (manifest.agent) {
          return `v${manifest.agent}`
        }
      }
    }
  } catch {
    // Fall through to default
  }
  // Fallback: should never be reached in a correctly configured environment.
  console.warn('[agent-version] Could not read .release-please-manifest.json — using fallback version')
  return 'v0.9.0'
}

export const REQUIRED_AGENT_VERSION = loadRequiredAgentVersion()
