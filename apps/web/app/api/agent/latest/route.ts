import { NextResponse } from 'next/server'

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? ''
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? ''

interface GitHubRelease {
  tag_name: string
  name: string
  published_at: string
  html_url: string
}

/**
 * Returns the latest agent release version.
 * Filters GitHub releases to those tagged agent/v* and returns the newest.
 */
export async function GET() {
  if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    return NextResponse.json(
      { error: 'GITHUB_REPO_OWNER and GITHUB_REPO_NAME must be set' },
      { status: 503 }
    )
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases?per_page=20`,
    { headers, next: { revalidate: 300 } }
  )

  if (!res.ok) {
    return NextResponse.json(
      { error: `GitHub API error: ${res.status}` },
      { status: 502 }
    )
  }

  const releases: GitHubRelease[] = await res.json()
  const agentRelease = releases.find((r) => r.tag_name.startsWith('agent/v'))

  if (!agentRelease) {
    return NextResponse.json({ error: 'No agent release found' }, { status: 404 })
  }

  const version = agentRelease.tag_name.replace('agent/', '')

  return NextResponse.json({
    version,
    tag: agentRelease.tag_name,
    published_at: agentRelease.published_at,
    release_url: agentRelease.html_url,
  })
}
