import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { AGENT_REPO_OWNER, AGENT_REPO_NAME } from '@/lib/agent/repo'
import { createRateLimiter } from '@/lib/rate-limit'

interface GitHubRelease {
  tag_name: string
  name: string
  published_at: string
  html_url: string
}

interface ReleasePayload {
  version: string
  tag: string
  published_at: string
  release_url: string
}

// ── Server-side TTL cache (per-process) ───────────────────────────────────────
// Prevents every request from fanning out to the GitHub API.
// Multi-instance deployments benefit further from the upstream CDN / fetch cache.
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
let cacheEntry: { data: ReleasePayload; expiresAt: number } | null = null

const latestRateLimit = createRateLimiter({
  scope: 'agent:latest',
  windowMs: 60_000,
  max: 10,
})

export async function GET() {
  const reqHeaders = await headers()
  const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  if (!await latestRateLimit.check(ip)) {
    return NextResponse.json(
      { error: 'Rate limited — please wait a moment before retrying.' },
      { status: 429 },
    )
  }

  // Serve from cache if still fresh
  const now = Date.now()
  if (cacheEntry && cacheEntry.expiresAt > now) {
    return NextResponse.json(cacheEntry.data, { headers: { 'X-Cache': 'HIT' } })
  }

  // Fetch from GitHub (one outbound call per cache miss)
  const fetchHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) {
    fetchHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const res = await fetch(
    `https://api.github.com/repos/${AGENT_REPO_OWNER}/${AGENT_REPO_NAME}/releases?per_page=20`,
    { headers: fetchHeaders },
  )

  if (!res.ok) {
    return NextResponse.json(
      { error: `GitHub API error: ${res.status}` },
      { status: 502 },
    )
  }

  const releases = (await res.json()) as GitHubRelease[]
  const agentRelease = releases.find((r) => r.tag_name.startsWith('agent/v'))

  if (!agentRelease) {
    return NextResponse.json({ error: 'No agent release found' }, { status: 404 })
  }

  const data: ReleasePayload = {
    version: agentRelease.tag_name.replace('agent/', ''),
    tag: agentRelease.tag_name,
    published_at: agentRelease.published_at,
    release_url: agentRelease.html_url,
  }

  cacheEntry = { data, expiresAt: now + CACHE_TTL_MS }

  return NextResponse.json(data, { headers: { 'X-Cache': 'MISS' } })
}
