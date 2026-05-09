import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REQUIRED_AGENT_VERSION } from './version.ts'
import { AGENT_REPO_OWNER, AGENT_REPO_NAME } from './repo.ts'

const AGENT_DIST_DIR = process.env.AGENT_DIST_DIR ?? './data/agent-dist'

export const SUPPORTED_OS = ['linux', 'darwin', 'windows'] as const
export const SUPPORTED_ARCH = ['amd64', 'arm64'] as const

export type AgentOS = (typeof SUPPORTED_OS)[number]
export type AgentArch = (typeof SUPPORTED_ARCH)[number]

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

const LATEST_RELEASE_CACHE_TTL_MS = 5 * 60 * 1000
let latestReleaseCache: { release: GitHubRelease | null; expiresAt: number } | null = null

export function binaryBaseName(os: AgentOS, arch: AgentArch): string {
  const suffix = os === 'windows' ? '.exe' : ''
  return `ct-ops-agent-${os}-${arch}${suffix}`
}

/**
 * Resolves the agent binary bytes for the given os/arch using the same
 * fallback strategy as the download route: local versioned cache, GitHub
 * release, unversioned local file, then the baked-in image directory.
 *
 * Returns null when no binary can be found (503-equivalent).
 */
export async function resolveAgentBinary(
  os: AgentOS,
  arch: AgentArch,
): Promise<{ bytes: Buffer; fileName: string } | null> {
  const baseName = binaryBaseName(os, arch)
  const suffix = os === 'windows' ? '.exe' : ''

  const latestRelease = await fetchLatestAgentRelease()
  const latestVersion = versionFromAgentTag(latestRelease?.tag_name)
  if (latestRelease && latestVersion) {
    const latest = await resolveFromRelease(latestRelease, latestVersion, os, arch, baseName, suffix)
    if (latest) return latest
  }

  const tag = `agent/${REQUIRED_AGENT_VERSION}`
  const requiredRelease = latestRelease?.tag_name === tag ? latestRelease : await fetchRelease(tag)
  if (requiredRelease?.tag_name === tag) {
    const required = await resolveFromRelease(
      requiredRelease,
      REQUIRED_AGENT_VERSION,
      os,
      arch,
      baseName,
      suffix,
    )
    if (required) return required
  }

  const unversionedPath = path.join(AGENT_DIST_DIR, baseName)
  const cachedUnversioned = await readVerifiedLocalBinary(unversionedPath, baseName)
  if (cachedUnversioned) {
    return { bytes: cachedUnversioned, fileName: baseName }
  }

  const bakedDistDir = path.join(process.cwd(), 'data/agent-dist')
  if (path.resolve(bakedDistDir) !== path.resolve(AGENT_DIST_DIR)) {
    const bakedPath = path.join(bakedDistDir, baseName)
    const baked = await readVerifiedLocalBinary(bakedPath, baseName)
    if (baked) {
      return { bytes: baked, fileName: baseName }
    }
  }

  return null
}

export function binaryUnavailableMessage(os: AgentOS, arch: AgentArch): string {
  return (
    `No binary available for ${os}/${arch} (latest agent release or required version: ${REQUIRED_AGENT_VERSION}). ` +
    `Either place a binary plus matching .sha256 sidecar in AGENT_DIST_DIR (${AGENT_DIST_DIR}) ` +
    `or ensure a GitHub agent release exists in ` +
    `${AGENT_REPO_OWNER}/${AGENT_REPO_NAME} with verified binary and checksum assets.`
  )
}

const ghHeaders: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
}

async function resolveFromRelease(
  release: GitHubRelease,
  version: string,
  os: AgentOS,
  arch: AgentArch,
  baseName: string,
  suffix: string,
): Promise<{ bytes: Buffer; fileName: string } | null> {
  const versionedName = `ct-ops-agent-${os}-${arch}-${version}${suffix}`
  const versionedPath = path.join(AGENT_DIST_DIR, versionedName)

  const cachedVersioned = await readVerifiedLocalBinary(versionedPath, baseName)
  if (cachedVersioned) {
    return { bytes: cachedVersioned, fileName: baseName }
  }

  const asset = release.assets.find((a) => a.name === baseName)
  const checksumAsset = release.assets.find((a) => a.name === `${baseName}.sha256`)
  if (!asset || !checksumAsset) return null

  const verified = await fetchVerifiedBinaryFromGitHub(asset, checksumAsset, baseName)
  if (!verified) return null

  await cacheLocally(versionedPath, verified.bytes, verified.checksumLine)
  return { bytes: Buffer.from(verified.bytes), fileName: baseName }
}

async function fetchLatestAgentRelease(): Promise<GitHubRelease | null> {
  const now = Date.now()
  if (latestReleaseCache && latestReleaseCache.expiresAt > now) {
    return latestReleaseCache.release
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${AGENT_REPO_OWNER}/${AGENT_REPO_NAME}/releases?per_page=20`,
      { headers: ghHeaders },
    )
    if (!res.ok) {
      latestReleaseCache = { release: null, expiresAt: now + LATEST_RELEASE_CACHE_TTL_MS }
      return null
    }
    const releases = (await res.json()) as GitHubRelease[]
    const release = releases.find((r) => versionFromAgentTag(r.tag_name)) ?? null
    latestReleaseCache = { release, expiresAt: now + LATEST_RELEASE_CACHE_TTL_MS }
    return release
  } catch {
    latestReleaseCache = { release: null, expiresAt: now + LATEST_RELEASE_CACHE_TTL_MS }
    return null
  }
}

async function fetchRelease(tag: string): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${AGENT_REPO_OWNER}/${AGENT_REPO_NAME}/releases/tags/${encodeURIComponent(tag)}`,
      { headers: ghHeaders },
    )
    if (!res.ok) return null
    return (await res.json()) as GitHubRelease
  } catch {
    return null
  }
}

function versionFromAgentTag(tag: string | undefined): string | null {
  const match = tag?.match(/^agent\/(v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/)
  return match?.[1] ?? null
}

async function fetchVerifiedBinaryFromGitHub(
  asset: GitHubAsset,
  checksumAsset: GitHubAsset,
  baseName: string,
): Promise<{ bytes: ArrayBuffer; checksumLine: string } | null> {
  const assetDigest = parseSha256Digest(asset.digest)
  const checksumAssetDigest = parseSha256Digest(checksumAsset.digest)
  if (!assetDigest || !checksumAssetDigest || asset.size <= 0 || checksumAsset.size <= 0) {
    return null
  }

  const checksumBytes = await fetchBytesFromGitHub(checksumAsset.browser_download_url)
  if (!checksumBytes) return null

  const checksumBuffer = Buffer.from(checksumBytes)
  if (
    checksumBuffer.byteLength !== checksumAsset.size ||
    sha256Hex(checksumBuffer) !== checksumAssetDigest
  ) {
    return null
  }

  const checksumText = checksumBuffer.toString('utf8')
  const expectedDigest = parseSha256Sidecar(checksumText, baseName)
  if (!expectedDigest || expectedDigest !== assetDigest) return null

  const binary = await fetchBytesFromGitHub(asset.browser_download_url)
  if (!binary) return null

  const binaryBuffer = Buffer.from(binary)
  if (binaryBuffer.byteLength !== asset.size || sha256Hex(binaryBuffer) !== expectedDigest) {
    return null
  }

  return { bytes: binary, checksumLine: `${expectedDigest}  ${baseName}\n` }
}

async function fetchBytesFromGitHub(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { headers: ghHeaders })
    if (!res.ok || !res.body) return null
    return res.arrayBuffer()
  } catch {
    return null
  }
}

async function readVerifiedLocalBinary(filePath: string, baseName: string): Promise<Buffer | null> {
  try {
    const [binary, checksumText] = await Promise.all([
      fs.promises.readFile(filePath),
      fs.promises.readFile(`${filePath}.sha256`, 'utf8'),
    ])
    const expectedDigest = parseSha256Sidecar(checksumText, baseName)
    if (!expectedDigest || sha256Hex(binary) !== expectedDigest) return null
    return binary
  } catch {
    return null
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

async function cacheLocally(filePath: string, data: ArrayBuffer, checksumLine: string): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, Buffer.from(data), { mode: 0o755 })
    await fs.promises.writeFile(`${filePath}.sha256`, checksumLine, { mode: 0o644 })
  } catch {
    // Cache failure is non-fatal
  }
}
