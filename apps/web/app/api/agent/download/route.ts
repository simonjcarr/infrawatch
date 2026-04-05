import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? ''
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? ''
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
 * Serves agent binaries for the requested OS/arch.
 *
 * Resolution order:
 *   1. Versioned local file (infrawatch-agent-linux-amd64-v0.3.0) — always fresh
 *   2. GitHub Releases — fetches latest, writes versioned file, serves it
 *   3. Unversioned fallback (manually placed air-gap binary)
 *   4. 503 if nothing available
 *
 * Versioned filenames mean a new GitHub release is automatically picked up
 * on the next request without any cache invalidation step.
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

  // ── 1 + 2: Try GitHub (get latest version, check versioned local file) ────
  if (GITHUB_REPO_OWNER && GITHUB_REPO_NAME) {
    const release = await fetchLatestRelease()
    if (release) {
      const version = release.tag_name.replace('agent/', '')
      const versionedName = `infrawatch-agent-${os}-${arch}-${version}${suffix}`
      const versionedPath = path.join(AGENT_DIST_DIR, versionedName)

      if (fs.existsSync(versionedPath)) {
        return streamFile(versionedPath, baseName)
      }

      // Not cached locally — fetch from GitHub and store
      const asset = release.assets.find((a) => a.name === baseName)
      if (asset) {
        const binary = await fetchBinaryFromGitHub(asset.browser_download_url)
        if (binary) {
          await cacheLocally(versionedPath, binary)
          return new NextResponse(binary, buildHeaders(baseName, binary.byteLength))
        }
      }
    }
  }

  // ── 3: Unversioned fallback (manually placed binaries for air-gap) ────────
  const unversionedPath = path.join(AGENT_DIST_DIR, baseName)
  if (fs.existsSync(unversionedPath)) {
    return streamFile(unversionedPath, baseName)
  }

  // ── 4: Nothing available ──────────────────────────────────────────────────
  return NextResponse.json(
    {
      error:
        `No binary found for ${os}/${arch}. ` +
        (GITHUB_REPO_OWNER
          ? 'GitHub release may not include this platform yet.'
          : `Set GITHUB_REPO_OWNER + GITHUB_REPO_NAME, or place the binary at: ${unversionedPath}`),
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

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases?per_page=20`,
      { headers: ghHeaders, next: { revalidate: 300 } }
    )
    if (!res.ok) return null
    const releases: GitHubRelease[] = await res.json()
    return releases.find((r) => r.tag_name.startsWith('agent/v')) ?? null
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
