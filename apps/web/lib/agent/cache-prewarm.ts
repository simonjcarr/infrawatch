import { logWarn } from '@/lib/logging'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { REQUIRED_AGENT_VERSION } from './version.ts'
import { AGENT_REPO_OWNER, AGENT_REPO_NAME } from './repo.ts'

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
  size: number
  digest?: string
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
  const bakedAvailability = await Promise.all(
    PLATFORMS.map(async ({ os, arch }) => {
      const baseName = binaryBaseName(os, arch)
      const isAvailable = await hasVerifiedLocalBinary(path.join(BAKED_AGENT_DIST_DIR, baseName), baseName)
      return { os, arch, isAvailable }
    })
  )
  const missingBaked = bakedAvailability.filter(({ isAvailable }) => !isAvailable)
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
    logWarn('[agent-cache] Could not reach GitHub — skipping prewarm', err)
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

  if (await hasVerifiedLocalBinary(versionedPath, baseName)) {
    console.log(`[agent-cache] ${versionedName} already cached`)
    return
  }

  const asset = release.assets.find((a) => a.name === baseName)
  const checksumAsset = release.assets.find((a) => a.name === `${baseName}.sha256`)
  if (!asset || !checksumAsset) {
    // Platform binary not in this release — skip silently
    return
  }

  console.log(`[agent-cache] Downloading ${versionedName}...`)
  try {
    const verified = await fetchVerifiedBinary(asset, checksumAsset, baseName)
    if (!verified) {
      console.warn(`[agent-cache] Failed to verify ${baseName} — skipping cache`)
      return
    }
    const buffer = Buffer.from(verified.bytes)
    await fs.promises.writeFile(versionedPath, buffer, { mode: 0o755 })
    await fs.promises.writeFile(`${versionedPath}.sha256`, verified.checksumLine, { mode: 0o644 })
    console.log(
      `[agent-cache] Cached ${versionedName} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`
    )
  } catch (err) {
    logWarn(`[agent-cache] Error downloading ${baseName}:`, err)
  }
}

async function fetchVerifiedBinary(
  asset: GitHubAsset,
  checksumAsset: GitHubAsset,
  baseName: string
): Promise<{ bytes: ArrayBuffer; checksumLine: string } | null> {
  const assetDigest = parseSha256Digest(asset.digest)
  const checksumAssetDigest = parseSha256Digest(checksumAsset.digest)
  if (!assetDigest || !checksumAssetDigest || asset.size <= 0 || checksumAsset.size <= 0) {
    return null
  }

  const checksumBytes = await fetchBytes(checksumAsset.browser_download_url)
  if (!checksumBytes) return null

  const checksumBuffer = Buffer.from(checksumBytes)
  if (
    checksumBuffer.byteLength !== checksumAsset.size ||
    sha256Hex(checksumBuffer) !== checksumAssetDigest
  ) {
    return null
  }

  const expectedDigest = parseSha256Sidecar(checksumBuffer.toString('utf8'), baseName)
  if (!expectedDigest || expectedDigest !== assetDigest) return null

  const binary = await fetchBytes(asset.browser_download_url)
  if (!binary) return null

  const binaryBuffer = Buffer.from(binary)
  if (binaryBuffer.byteLength !== asset.size || sha256Hex(binaryBuffer) !== expectedDigest) {
    return null
  }

  return { bytes: binary, checksumLine: `${expectedDigest}  ${baseName}\n` }
}

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })
  if (!res.ok || !res.body) return null
  return res.arrayBuffer()
}

async function hasVerifiedLocalBinary(filePath: string, baseName: string): Promise<boolean> {
  try {
    const [binary, checksumText] = await Promise.all([
      fs.promises.readFile(filePath),
      fs.promises.readFile(`${filePath}.sha256`, 'utf8'),
    ])
    const expectedDigest = parseSha256Sidecar(checksumText, baseName)
    return Boolean(expectedDigest && sha256Hex(binary) === expectedDigest)
  } catch {
    return false
  }
}

function parseSha256Digest(digest: string | undefined): string | null {
  const match = digest?.match(/^sha256:([a-f0-9]{64})$/i)
  const value = match?.[1]
  return value ? value.toLowerCase() : null
}

function parseSha256Sidecar(contents: string, baseName: string): string | null {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
    const value = match?.[1]
    if (value && match?.[2] === baseName) {
      return value.toLowerCase()
    }
  }
  return null
}

function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}
