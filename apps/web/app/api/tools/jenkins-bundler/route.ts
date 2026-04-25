import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  type UpdateCenterPlugin,
  getLatestLtsVersion,
  getUpdateCenterForCore,
  resolveWarUrl,
} from '@/lib/jenkins/update-center'
import { compareVersions } from '@/lib/version-compare'

export const runtime = 'nodejs'

export type ResolvedPlugin = {
  name: string
  requested: string
  status: 'compatible' | 'not-found' | 'core-incompatible'
  version?: string
  url?: string
  requiredCore?: string
  size?: number
  sha256?: string
  reason?: string
}

export type ResolveResponse = {
  ok: true
  coreVersion: string
  warUrl: string | null
  plugins: ResolvedPlugin[]
}

export type JenkinsBundlerResponse =
  | ResolveResponse
  | { ok: true; version: string }
  | { ok: false; error: string }

const LatestLtsSchema = z.object({ action: z.literal('latest-lts') })

const ResolveSchema = z.object({
  action: z.literal('resolve'),
  coreVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/, 'Expected version like 2.462.3'),
  // Empty plugin list is allowed — a user can bundle just the WAR.
  plugins: z.array(z.string().min(1).max(200)).max(500),
})

const BodySchema = z.discriminatedUnion('action', [LatestLtsSchema, ResolveSchema])

function resolvePlugins(
  names: string[],
  coreVersion: string,
  catalogue: Record<string, UpdateCenterPlugin>,
): ResolvedPlugin[] {
  const seen = new Set<string>()
  const out: ResolvedPlugin[] = []
  for (const raw of names) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    // Accept "name" or "name:version" or "name@version" — we always pick the
    // latest compatible version, so the user's version pin is informational.
    const name = trimmed.split(/[:@\s]/)[0]!.toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)

    const p = catalogue[name]
    if (!p) {
      out.push({
        name,
        requested: trimmed,
        status: 'not-found',
        reason: 'Plugin not found in the Jenkins update catalogue',
      })
      continue
    }

    if (compareVersions(p.requiredCore, coreVersion) > 0) {
      out.push({
        name,
        requested: trimmed,
        status: 'core-incompatible',
        version: p.version,
        url: p.url,
        requiredCore: p.requiredCore,
        size: p.size,
        sha256: p.sha256,
        reason: `Requires Jenkins core ${p.requiredCore} (you have ${coreVersion})`,
      })
      continue
    }

    out.push({
      name,
      requested: trimmed,
      status: 'compatible',
      version: p.version,
      url: p.url,
      requiredCore: p.requiredCore,
      size: p.size,
      sha256: p.sha256,
    })
  }
  return out
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    )
  }

  try {
    if (parsed.data.action === 'latest-lts') {
      const version = await getLatestLtsVersion()
      return NextResponse.json({ ok: true, version } satisfies JenkinsBundlerResponse)
    }

    const { coreVersion, plugins: requested } = parsed.data
    const [catalogue, warUrl] = await Promise.all([
      getUpdateCenterForCore(coreVersion),
      resolveWarUrl(coreVersion),
    ])

    const resolved = resolvePlugins(requested, coreVersion, catalogue)

    return NextResponse.json({
      ok: true,
      coreVersion,
      warUrl,
      plugins: resolved,
    } satisfies JenkinsBundlerResponse)
  } catch (err) {
    console.error('[jenkins-bundler] error:', err)
    const message = err instanceof Error ? err.message : 'Internal error'
    const isSafe =
      message.startsWith('Upstream returned') ||
      message.startsWith('Unable to fetch') ||
      message.startsWith('Unexpected latestCore')
    return NextResponse.json(
      { ok: false, error: isSafe ? message : 'An unexpected error occurred while contacting updates.jenkins.io' },
      { status: 502 },
    )
  }
}

/**
 * Streaming download proxy. The browser cannot fetch plugin .hpi files
 * directly due to CORS, so we pipe them through the server.
 *
 * The proxy deliberately does not accept a user-supplied URL — that would be
 * SSRF-able even with a hostname allow-list because redirects could land on
 * private addresses. Instead we rebuild the URL server-side from a kind and a
 * set of strictly-validated identifiers so the string passed to fetch is
 * always one of two literal templates against updates.jenkins.io /
 * get.jenkins.io.
 */
const WarQuerySchema = z.object({
  kind: z.literal('war'),
  version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
})

const PluginQuerySchema = z.object({
  kind: z.literal('plugin'),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i).max(100),
  version: z.string().regex(/^[0-9][0-9A-Za-z.+_-]*$/).max(100),
})

const QuerySchema = z.discriminatedUnion('kind', [WarQuerySchema, PluginQuerySchema])

export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries())
  const parsed = QuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or missing parameters' },
      { status: 400 },
    )
  }

  let resolvedUrl: string
  if (parsed.data.kind === 'war') {
    const { version } = parsed.data
    const war = await resolveWarUrl(version)
    if (!war) {
      return NextResponse.json(
        { ok: false, error: 'No Jenkins WAR published for that version' },
        { status: 404 },
      )
    }
    resolvedUrl = war
  } else {
    const { name, version } = parsed.data
    resolvedUrl = `https://updates.jenkins.io/download/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}/${encodeURIComponent(name)}.hpi`
  }

  const upstream = await fetch(resolvedUrl, { cache: 'no-store', redirect: 'follow' })
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { ok: false, error: `Upstream returned ${upstream.status}` },
      { status: 502 },
    )
  }

  const headers = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  const cl = upstream.headers.get('content-length')
  if (cl) headers.set('content-length', cl)
  headers.set('cache-control', 'no-store')

  return new Response(upstream.body, { status: 200, headers })
}
