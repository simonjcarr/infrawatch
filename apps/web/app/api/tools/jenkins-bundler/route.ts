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
  status: 'compatible' | 'java-incompatible' | 'not-found' | 'core-incompatible'
  version?: string
  url?: string
  requiredCore?: string
  minimumJavaVersion?: string
  size?: number
  sha256?: string
  reason?: string
}

export type ResolvedPluginNode = ResolvedPlugin & {
  origin: 'requested' | 'required-dep' | 'optional-dep'
  // undefined  → not expanded (toggle off, or this is an optional/cycle leaf)
  // []         → expanded; plugin has no dependencies
  // non-empty  → expanded; these are the direct deps
  dependencies?: ResolvedPluginNode[]
  // The version string the parent dep edge asked for. Surfaces conflicts when
  // a parent wanted a newer version than the catalogue currently serves.
  requiredByVersion?: string
  // Stopped recursion because this name is already on the active recursion
  // path (true cycle).
  cycle?: boolean
  // Stopped recursion because this name was already fully expanded under a
  // different parent in this tree. Not a cycle, just dedup.
  alreadyListed?: boolean
}

export type ResolveResponse = {
  ok: true
  coreVersion: string
  // Null when updates.jenkins.io did not publish a per-version catalogue for
  // the requested WAR, in which case we have no authoritative answer and we
  // refuse to guess. The UI surfaces this as "could not determine".
  coreMinimumJava: number | null
  coreJavaSource: 'updates.jenkins.io' | 'unavailable'
  // Null when either the user didn't specify a Java version, or we couldn't
  // determine the WAR's requirement.
  javaCompatible: boolean | null
  warUrl: string | null
  plugins: ResolvedPluginNode[]
  // Deduplicated flat list of every required transitive dependency that the
  // bundle download should pull. Excludes user-requested plugins (those are
  // top-level entries in `plugins`), excludes optional deps (not followed),
  // and excludes not-found / incompatible deps (no downloadable artefact).
  // Empty when `includeTransitiveDeps` was not requested.
  transitivePlugins: ResolvedPlugin[]
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
  javaVersion: z.number().int().min(1).max(99).optional(),
  // When true, the resolver walks each requested plugin's required deps
  // recursively and returns the full tree plus a deduplicated flat list of
  // transitive dependencies. Optional deps are surfaced but not followed.
  includeTransitiveDeps: z.boolean().optional().default(false),
})

const BodySchema = z.discriminatedUnion('action', [LatestLtsSchema, ResolveSchema])

function extractJavaMajor(s: string | undefined): number | null {
  if (!s) return null
  // Normalise "1.8" → 8, "11" → 11, "17.0.2" → 17.
  const m = s.match(/^\s*1\.(\d+)/) ?? s.match(/^\s*(\d+)/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  return Number.isFinite(n) ? n : null
}

function resolveOne(
  name: string,
  requested: string,
  coreVersion: string,
  catalogue: Record<string, UpdateCenterPlugin>,
  userJava: number | null,
): ResolvedPlugin {
  const p = catalogue[name]
  if (!p) {
    return {
      name,
      requested,
      status: 'not-found',
      reason: 'Plugin not found in the Jenkins update catalogue',
    }
  }

  if (compareVersions(p.requiredCore, coreVersion) > 0) {
    return {
      name,
      requested,
      status: 'core-incompatible',
      version: p.version,
      url: p.url,
      requiredCore: p.requiredCore,
      minimumJavaVersion: p.minimumJavaVersion,
      size: p.size,
      sha256: p.sha256,
      reason: `Requires Jenkins core ${p.requiredCore} (you have ${coreVersion})`,
    }
  }

  const pluginJava = extractJavaMajor(p.minimumJavaVersion)
  if (userJava != null && pluginJava != null && pluginJava > userJava) {
    return {
      name,
      requested,
      status: 'java-incompatible',
      version: p.version,
      url: p.url,
      requiredCore: p.requiredCore,
      minimumJavaVersion: p.minimumJavaVersion,
      size: p.size,
      sha256: p.sha256,
      reason: `Requires Java ${pluginJava} (you have Java ${userJava})`,
    }
  }

  return {
    name,
    requested,
    status: 'compatible',
    version: p.version,
    url: p.url,
    requiredCore: p.requiredCore,
    minimumJavaVersion: p.minimumJavaVersion,
    size: p.size,
    sha256: p.sha256,
  }
}

/**
 * Resolves a list of user-requested plugin names into a tree of nodes,
 * optionally recursing through each plugin's required dependencies. Returns:
 *
 *   - `plugins`: one node per requested name, each with a `dependencies` array
 *     populated when `includeTransitive` is true. Cycle / already-listed
 *     leaves are emitted in-place so the tree faithfully reflects relationships
 *     without infinite recursion.
 *   - `transitivePlugins`: deduplicated flat list of every compatible required
 *     dep that should be added to the bundle (excludes the requested names —
 *     those are downloaded from `plugins`).
 *
 * Optional deps appear as leaf nodes (`origin: 'optional-dep'`,
 * `dependencies: undefined`) so the user sees them, but they are not recursed
 * into and not added to the flat list. This matches Jenkins' own install
 * behaviour where optional deps are not auto-installed.
 */
function resolveTree(
  names: string[],
  coreVersion: string,
  catalogue: Record<string, UpdateCenterPlugin>,
  userJava: number | null,
  includeTransitive: boolean,
): { plugins: ResolvedPluginNode[]; transitivePlugins: ResolvedPlugin[] } {
  const requestedSet = new Set<string>()
  const seenInput = new Set<string>()
  const requestedNodes: ResolvedPluginNode[] = []

  for (const raw of names) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    // Accept "name", "name:version", or "name@version" — the version pin is
    // informational; we always pick the catalogue's latest compatible version.
    const name = trimmed.split(/[:@\s]/)[0]!.toLowerCase()
    if (seenInput.has(name)) continue
    seenInput.add(name)
    requestedSet.add(name)

    const base = resolveOne(name, trimmed, coreVersion, catalogue, userJava)
    requestedNodes.push({ ...base, origin: 'requested' })
  }

  if (!includeTransitive) {
    return { plugins: requestedNodes, transitivePlugins: [] }
  }

  // `expanded` tracks names whose subtree has been fully expanded once already
  // — used to short-circuit re-expansion of a dep that's reached via two
  // different parents (not a cycle, just dedup).
  const expanded = new Set<string>()
  // `transitive` is the deduplicated flat list of compatible required deps.
  // Keyed by lowercased name. Excludes user-requested names entirely.
  const transitive = new Map<string, ResolvedPlugin>()

  function expand(
    node: ResolvedPluginNode,
    pathStack: Set<string>,
  ): void {
    if (node.status !== 'compatible') {
      // Incompatible / not-found nodes have no deps to walk.
      node.dependencies = []
      return
    }
    const cat = catalogue[node.name]
    if (!cat || !cat.dependencies || cat.dependencies.length === 0) {
      node.dependencies = []
      return
    }

    expanded.add(node.name)
    pathStack.add(node.name)
    const children: ResolvedPluginNode[] = []

    for (const dep of cat.dependencies) {
      const depName = dep.name.toLowerCase()

      if (dep.optional) {
        // Surface optional deps but don't recurse into them and don't add to
        // the flat bundle list. `dependencies` left undefined → no chevron.
        const cataloguePlugin = catalogue[depName]
        children.push({
          name: depName,
          requested: depName,
          status: cataloguePlugin ? 'compatible' : 'not-found',
          version: cataloguePlugin?.version,
          url: cataloguePlugin?.url,
          requiredCore: cataloguePlugin?.requiredCore,
          minimumJavaVersion: cataloguePlugin?.minimumJavaVersion,
          size: cataloguePlugin?.size,
          sha256: cataloguePlugin?.sha256,
          origin: 'optional-dep',
          requiredByVersion: dep.version,
        })
        continue
      }

      // True cycle — depName is on the active recursion path back to a
      // grandparent. Emit a leaf and stop.
      if (pathStack.has(depName)) {
        children.push({
          name: depName,
          requested: depName,
          status: 'compatible',
          version: catalogue[depName]?.version,
          origin: 'required-dep',
          requiredByVersion: dep.version,
          cycle: true,
        })
        continue
      }

      const resolved = resolveOne(depName, depName, coreVersion, catalogue, userJava)
      const child: ResolvedPluginNode = {
        ...resolved,
        origin: 'required-dep',
        requiredByVersion: dep.version,
      }

      // Add to the deduplicated flat list only if compatible AND not also
      // a user-requested plugin (those live at the top level).
      if (
        child.status === 'compatible'
        && !requestedSet.has(depName)
        && !transitive.has(depName)
      ) {
        // Strip node-only fields when promoting to the flat list.
        const { name, requested, status, version, url, requiredCore, minimumJavaVersion, size, sha256, reason } = child
        transitive.set(depName, {
          name,
          requested,
          status,
          version,
          url,
          requiredCore,
          minimumJavaVersion,
          size,
          sha256,
          reason,
        })
      }

      // Already fully expanded under another parent — keep as a leaf,
      // no further recursion (not a cycle, just dedup).
      if (expanded.has(depName)) {
        child.alreadyListed = true
        children.push(child)
        continue
      }

      expand(child, pathStack)
      children.push(child)
    }

    pathStack.delete(node.name)
    node.dependencies = children
  }

  for (const node of requestedNodes) {
    expand(node, new Set<string>())
  }

  return { plugins: requestedNodes, transitivePlugins: Array.from(transitive.values()) }
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

    const { coreVersion, plugins: requested, javaVersion, includeTransitiveDeps } = parsed.data
    const [uc, warUrl] = await Promise.all([
      getUpdateCenterForCore(coreVersion),
      resolveWarUrl(coreVersion),
    ])

    // The only Java-requirement source we trust is updates.jenkins.io's
    // per-version catalogue, and only when its `core.version` matches the
    // user's WAR. If the catalogue isn't published for this version (or only
    // the "current" weekly catalogue responded), we report `unavailable`
    // rather than guessing.
    const liveJava = uc.coreVersionMatches ? extractJavaMajor(uc.coreRequiredJavaVersion) : null
    const coreMinimumJava = liveJava
    const coreJavaSource: ResolveResponse['coreJavaSource'] =
      liveJava != null ? 'updates.jenkins.io' : 'unavailable'
    const javaCompatible =
      javaVersion == null || coreMinimumJava == null ? null : javaVersion >= coreMinimumJava

    const { plugins: resolved, transitivePlugins } = resolveTree(
      requested,
      coreVersion,
      uc.plugins,
      javaVersion ?? null,
      includeTransitiveDeps,
    )

    return NextResponse.json({
      ok: true,
      coreVersion,
      coreMinimumJava,
      coreJavaSource,
      javaCompatible,
      warUrl,
      plugins: resolved,
      transitivePlugins,
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
