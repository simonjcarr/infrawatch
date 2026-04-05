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
  content_type: string
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
 *   1. Local filesystem at AGENT_DIST_DIR — serves immediately (air-gap safe)
 *   2. GitHub Releases proxy — fetches, caches to AGENT_DIST_DIR, then serves
 *   3. Neither available — 503 with instructions
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
  const assetName = `infrawatch-agent-${os}-${arch}${suffix}`
  const localPath = path.join(AGENT_DIST_DIR, assetName)

  // ── 1. Serve from local cache if present ──────────────────────────────────
  if (fs.existsSync(localPath)) {
    return streamLocalFile(localPath, assetName)
  }

  // ── 2. Fetch from GitHub and cache locally ────────────────────────────────
  if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    return NextResponse.json(
      {
        error:
          `Binary not found locally and GitHub is not configured. ` +
          `Either set GITHUB_REPO_OWNER + GITHUB_REPO_NAME env vars, ` +
          `or place the binary at: ${localPath}`,
      },
      { status: 503 }
    )
  }

  const ghHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) {
    ghHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const releasesRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases?per_page=20`,
    { headers: ghHeaders, next: { revalidate: 300 } }
  )
  if (!releasesRes.ok) {
    return NextResponse.json(
      { error: `GitHub API error: ${releasesRes.status}` },
      { status: 502 }
    )
  }

  const releases: GitHubRelease[] = await releasesRes.json()
  const agentRelease = releases.find((r) => r.tag_name.startsWith('agent/v'))

  if (!agentRelease) {
    return NextResponse.json({ error: 'No agent release found on GitHub' }, { status: 404 })
  }

  const asset = agentRelease.assets.find((a) => a.name === assetName)
  if (!asset) {
    return NextResponse.json(
      { error: `Binary not found for ${os}/${arch} in release ${agentRelease.tag_name}` },
      { status: 404 }
    )
  }

  const binaryRes = await fetch(asset.browser_download_url, { headers: ghHeaders })
  if (!binaryRes.ok || !binaryRes.body) {
    return NextResponse.json({ error: 'Failed to fetch binary from GitHub' }, { status: 502 })
  }

  const binaryBuffer = Buffer.from(await binaryRes.arrayBuffer())

  // Cache to local filesystem for future requests (and air-gap use)
  try {
    await fs.promises.mkdir(AGENT_DIST_DIR, { recursive: true })
    await fs.promises.writeFile(localPath, binaryBuffer, { mode: 0o755 })
  } catch {
    // Cache failure is non-fatal — still serve the binary
  }

  return new NextResponse(binaryBuffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${assetName}"`,
      'Content-Length': String(binaryBuffer.length),
    },
  })
}

function streamLocalFile(localPath: string, assetName: string): NextResponse {
  const buffer = fs.readFileSync(localPath)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${assetName}"`,
      'Content-Length': String(buffer.length),
    },
  })
}
