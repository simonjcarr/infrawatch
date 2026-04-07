import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { REQUIRED_AGENT_VERSION } from '@/lib/agent/version'
import { AGENT_REPO_OWNER, AGENT_REPO_NAME } from '@/lib/agent/repo'

const AGENT_DIST_DIR = process.env.AGENT_DIST_DIR ?? './data/agent-dist'

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

const SUPPORTED_OS = ['linux', 'darwin', 'windows']
const SUPPORTED_ARCH = ['amd64', 'arm64']

/**
 * Serves the agent binary for the required version (pinned in lib/agent/version.ts).
 *
 * Resolution order:
 *   1. Versioned local file (infrawatch-agent-linux-amd64-v0.1.0) — served immediately if cached
 *   2. GitHub Release for the required version — downloads, caches, then serves
 *   3. Unversioned fallback (manually built via `make agent`) — for local dev without releases
 *   4. 503 if nothing available
 *
 * Query params: os (linux|darwin|windows), arch (amd64|arm64)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const os = searchParams.get('os')
  const arch = searchParams.get('arch')

  if (!os || !SUPPORTED_OS.includes(os)) {
    return NextResponse.json(
      { error: `os must be one of: ${SUPPORTED_OS.join(', ')}` },
      { status: 400 }
    )
  }
  if (!arch || !SUPPORTED_ARCH.includes(arch)) {
    return NextResponse.json(
      { error: `arch must be one of: ${SUPPORTED_ARCH.join(', ')}` },
      { status: 400 }
    )
  }

  const suffix = os === 'windows' ? '.exe' : ''
  const baseName = `infrawatch-agent-${os}-${arch}${suffix}`
  const versionedName = `infrawatch-agent-${os}-${arch}-${REQUIRED_AGENT_VERSION}${suffix}`
  const versionedPath = path.join(AGENT_DIST_DIR, versionedName)

  // ── 1: Already cached locally ─────────────────────────────────────────────
  if (fs.existsSync(versionedPath)) {
    return streamFile(versionedPath, baseName)
  }

  // ── 2: Fetch from GitHub release for the required version ─────────────────
  const tag = `agent/${REQUIRED_AGENT_VERSION}`
  const release = await fetchRelease(tag)
  if (release) {
    const asset = release.assets.find((a) => a.name === baseName)
    if (asset) {
      const binary = await fetchBinaryFromGitHub(asset.browser_download_url)
      if (binary) {
        await cacheLocally(versionedPath, binary)
        return new NextResponse(binary, buildHeaders(baseName, binary.byteLength))
      }
    }
  }

  // ── 3: Unversioned fallback (locally built via `make agent`) ──────────────
  const unversionedPath = path.join(AGENT_DIST_DIR, baseName)
  if (fs.existsSync(unversionedPath)) {
    return streamFile(unversionedPath, baseName)
  }

  // ── 4: Nothing available ──────────────────────────────────────────────────
  return NextResponse.json(
    {
      error:
        `No binary available for ${os}/${arch} (required version: ${REQUIRED_AGENT_VERSION}). ` +
        `Ensure a GitHub release exists for tag "agent/${REQUIRED_AGENT_VERSION}" in ${AGENT_REPO_OWNER}/${AGENT_REPO_NAME}.`,
    },
    { status: 503 }
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      { headers: ghHeaders }
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

function streamFile(filePath: string, downloadName: string): NextResponse {
  const buffer = fs.readFileSync(filePath)
  return new NextResponse(buffer, buildHeaders(downloadName, buffer.byteLength))
}

function buildHeaders(
  downloadName: string,
  length: number
): ConstructorParameters<typeof NextResponse>[1] {
  return {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Content-Length': String(length),
    },
  }
}
