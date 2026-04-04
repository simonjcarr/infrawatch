import { NextRequest, NextResponse } from 'next/server'

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? ''
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? ''

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
 * Proxies an agent binary download from the latest GitHub Release.
 * Query params: os (linux|darwin|windows), arch (amd64|arm64)
 *
 * The agent always downloads through this endpoint — it never hits GitHub
 * directly. This allows the download source to change without updating agents,
 * and supports air-gapped deployments in the future.
 */
export async function GET(request: NextRequest) {
  if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    return NextResponse.json(
      { error: 'GITHUB_REPO_OWNER and GITHUB_REPO_NAME must be set' },
      { status: 503 }
    )
  }

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

  const ghHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) {
    ghHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  // Find the latest agent release (tag prefix agent/v*)
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
    return NextResponse.json({ error: 'No agent release found' }, { status: 404 })
  }

  // Asset name: infrawatch-agent-{os}-{arch}[.exe]
  const suffix = os === 'windows' ? '.exe' : ''
  const assetName = `infrawatch-agent-${os}-${arch}${suffix}`
  const asset = agentRelease.assets.find((a) => a.name === assetName)

  if (!asset) {
    return NextResponse.json(
      { error: `Binary not found for ${os}/${arch} in release ${agentRelease.tag_name}` },
      { status: 404 }
    )
  }

  // Proxy the binary through this server — clients never touch GitHub directly.
  const binaryRes = await fetch(asset.browser_download_url, {
    headers: ghHeaders,
  })
  if (!binaryRes.ok || !binaryRes.body) {
    return NextResponse.json(
      { error: 'Failed to fetch binary from GitHub' },
      { status: 502 }
    )
  }

  return new NextResponse(binaryRes.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${assetName}"`,
      ...(asset.size ? { 'Content-Length': String(asset.size) } : {}),
    },
  })
}
