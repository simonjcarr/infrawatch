import fs from 'fs'
import path from 'path'
import { REQUIRED_AGENT_VERSION } from './version'
import { AGENT_REPO_OWNER, AGENT_REPO_NAME } from './repo'

const AGENT_DIST_DIR = process.env.AGENT_DIST_DIR ?? './data/agent-dist'

export const SUPPORTED_OS = ['linux', 'darwin', 'windows'] as const
export const SUPPORTED_ARCH = ['amd64', 'arm64'] as const

export type AgentOS = (typeof SUPPORTED_OS)[number]
export type AgentArch = (typeof SUPPORTED_ARCH)[number]

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

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
  const versionedName = `ct-ops-agent-${os}-${arch}-${REQUIRED_AGENT_VERSION}${suffix}`
  const versionedPath = path.join(AGENT_DIST_DIR, versionedName)

  if (fs.existsSync(versionedPath)) {
    return { bytes: await fs.promises.readFile(versionedPath), fileName: baseName }
  }

  const tag = `agent/${REQUIRED_AGENT_VERSION}`
  const release = await fetchRelease(tag)
  if (release) {
    const asset = release.assets.find((a) => a.name === baseName)
    if (asset) {
      const binary = await fetchBinaryFromGitHub(asset.browser_download_url)
      if (binary) {
        await cacheLocally(versionedPath, binary)
        return { bytes: Buffer.from(binary), fileName: baseName }
      }
    }
  }

  const unversionedPath = path.join(AGENT_DIST_DIR, baseName)
  if (fs.existsSync(unversionedPath)) {
    return { bytes: await fs.promises.readFile(unversionedPath), fileName: baseName }
  }

  const bakedDistDir = path.join(process.cwd(), 'data/agent-dist')
  if (path.resolve(bakedDistDir) !== path.resolve(AGENT_DIST_DIR)) {
    const bakedPath = path.join(bakedDistDir, baseName)
    if (fs.existsSync(bakedPath)) {
      return { bytes: await fs.promises.readFile(bakedPath), fileName: baseName }
    }
  }

  return null
}

export function binaryUnavailableMessage(os: AgentOS, arch: AgentArch): string {
  return (
    `No binary available for ${os}/${arch} (required version: ${REQUIRED_AGENT_VERSION}). ` +
    `Either place a binary in AGENT_DIST_DIR (${AGENT_DIST_DIR}) or ensure a GitHub release ` +
    `exists for tag "agent/${REQUIRED_AGENT_VERSION}" in ${AGENT_REPO_OWNER}/${AGENT_REPO_NAME}.`
  )
}

const ghHeaders: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
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

async function fetchBinaryFromGitHub(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { headers: ghHeaders })
    if (!res.ok || !res.body) return null
    return res.arrayBuffer()
  } catch {
    return null
  }
}

async function cacheLocally(filePath: string, data: ArrayBuffer): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, Buffer.from(data), { mode: 0o755 })
  } catch {
    // Cache failure is non-fatal
  }
}
