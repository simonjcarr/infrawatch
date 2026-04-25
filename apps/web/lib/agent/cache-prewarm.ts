import fs from 'fs'
import path from 'path'
import { REQUIRED_AGENT_VERSION } from './version'
import { AGENT_REPO_OWNER, AGENT_REPO_NAME } from './repo'

const AGENT_DIST_DIR = process.env.AGENT_DIST_DIR ?? './data/agent-dist'
const BAKED_AGENT_DIST_DIR = path.join(process.cwd(), 'data/agent-dist')

const PLATFORMS = [
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'darwin', arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
  { os: 'windows', arch: 'arm64' },
]

interface GitHubAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

/**
 * Downloads any missing agent binaries for the required version on startup.
 * The required version is pinned in lib/agent/version.ts and must match a
 * GitHub release tagged "agent/<version>".
 *
 * Skips platforms already cached. Logs progress but never throws — a cache
 * prewarm failure must never prevent the server from starting.
 */
export async function prewarmAgentCache(): Promise<void> {
  const missingBaked = PLATFORMS.filter(
    ({ os, arch }) => !fs.existsSync(path.join(BAKED_AGENT_DIST_DIR, binaryBaseName(os, arch)))
  )
  if (missingBaked.length === 0) {
    console.log(`[agent-cache] Baked agent ${REQUIRED_AGENT_VERSION} binaries are available`)
    return
  }

  const tag = `agent/${REQUIRED_AGENT_VERSION}`
  let release: GitHubRelease | null = null

  try {
    const res = await fetch(
      `https://api.github.com/repos/${AGENT_REPO_OWNER}/${AGENT_REPO_NAME}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      }
    )
    if (res.status === 404) {
      const missingPlatforms = missingBaked.map(({ os, arch }) => `${os}/${arch}`).join(', ')
      console.log(
        `[agent-cache] Release ${tag} not found on GitHub and baked binaries are incomplete — missing ${missingPlatforms}`
      )
      return
    }
    if (!res.ok) {
      console.warn(`[agent-cache] GitHub API returned ${res.status} — skipping prewarm`)
      return
    }
    release = (await res.json()) as GitHubRelease
  } catch (err) {
    console.warn('[agent-cache] Could not reach GitHub — skipping prewarm', err)
    return
  }

  console.log(`[agent-cache] Caching agent ${REQUIRED_AGENT_VERSION} for all platforms...`)
  await fs.promises.mkdir(AGENT_DIST_DIR, { recursive: true })

  await Promise.allSettled(
    PLATFORMS.map(({ os, arch }) => downloadIfMissing(release!, REQUIRED_AGENT_VERSION, os, arch))
  )
}

function binaryBaseName(os: string, arch: string): string {
  const suffix = os === 'windows' ? '.exe' : ''
  return `ct-ops-agent-${os}-${arch}${suffix}`
}

async function downloadIfMissing(
  release: GitHubRelease,
  version: string,
  os: string,
  arch: string
): Promise<void> {
  const suffix = os === 'windows' ? '.exe' : ''
  const baseName = `ct-ops-agent-${os}-${arch}${suffix}`
  const versionedName = `ct-ops-agent-${os}-${arch}-${version}${suffix}`
  const versionedPath = path.join(AGENT_DIST_DIR, versionedName)

  if (fs.existsSync(versionedPath)) {
    console.log(`[agent-cache] ${versionedName} already cached`)
    return
  }

  const asset = release.assets.find((a) => a.name === baseName)
  if (!asset) {
    // Platform binary not in this release — skip silently
    return
  }

  console.log(`[agent-cache] Downloading ${versionedName}...`)
  try {
    const res = await fetch(asset.browser_download_url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    })
    if (!res.ok) {
      console.warn(`[agent-cache] Failed to download ${baseName}: HTTP ${res.status}`)
      return
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    await fs.promises.writeFile(versionedPath, buffer, { mode: 0o755 })
    console.log(
      `[agent-cache] Cached ${versionedName} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`
    )
  } catch (err) {
    console.warn(`[agent-cache] Error downloading ${baseName}:`, err)
  }
}
