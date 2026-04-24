/**
 * Minimal client for the Jenkins update-center metadata served from
 * https://updates.jenkins.io. Used by the Air-gap Bundlers tool to resolve
 * the latest plugin versions compatible with a given Jenkins core WAR.
 *
 * All network access goes through this module so the API route stays thin
 * and the URL allow-list lives in one place.
 */
import { compareVersions } from '@/lib/version-compare'

const JENKINS_UPDATE_BASE = 'https://updates.jenkins.io'
const JENKINS_DOWNLOAD_BASE = 'https://get.jenkins.io'

export type UpdateCenterPlugin = {
  name: string
  version: string
  url: string
  requiredCore: string
  minimumJavaVersion?: string
  dependencies?: Array<{ name: string; optional: boolean; version: string }>
  size?: number
  sha256?: string
  sha1?: string
}

export type UpdateCenter = {
  coreVersion: string
  // True iff the catalogue we successfully fetched is for the exact core
  // version requested. Only when this is true should `coreRequiredJavaVersion`
  // be trusted as the authoritative answer for the user's WAR — otherwise
  // we've fallen back to a broader catalogue whose `core` describes a
  // different version.
  coreVersionMatches: boolean
  coreRequiredJavaVersion?: string
  plugins: Record<string, UpdateCenterPlugin>
}

type RawUpdateCenter = {
  core?: {
    version?: string
    requiredJavaVersion?: string
  }
  plugins?: Record<
    string,
    {
      name?: string
      version?: string
      url?: string
      requiredCore?: string
      minimumJavaVersion?: string
      dependencies?: Array<{ name: string; optional: boolean; version: string }>
      size?: number
      sha256?: string
      sha1?: string
    }
  >
}

const FETCH_TIMEOUT_MS = 30_000

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`Upstream returned ${res.status} for ${url}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`Upstream returned ${res.status} for ${url}`)
    }
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

/** Fetches the current Jenkins LTS core version, e.g. "2.462.3". */
export async function getLatestLtsVersion(): Promise<string> {
  const raw = await fetchText(`${JENKINS_UPDATE_BASE}/stable/latestCore.txt`)
  const v = raw.trim()
  if (!/^\d+\.\d+(\.\d+)?$/.test(v)) {
    throw new Error(`Unexpected latestCore response: ${v.slice(0, 40)}`)
  }
  return v
}

/**
 * Fetches the update-center catalogue for a specific core version.
 *
 * Jenkins infrastructure (`update-center2`) generates `dynamic-{version}`
 * catalogues per published core release, and the catalogue's `core` object
 * describes that exact core (including `requiredJavaVersion`). We query
 * that endpoint first so the Java requirement comes from upstream, not a
 * stale local table. If the per-version endpoint isn't published (rare,
 * but possible for one-off weeklies), we fall back to the "current"
 * catalogue — which is fine for resolving plugin compatibility but its
 * `core` describes a different version, so we mark the result with
 * `coreVersionMatches: false` and the caller treats `coreRequiredJavaVersion`
 * as untrustworthy.
 */
export async function getUpdateCenterForCore(coreVersion: string): Promise<UpdateCenter> {
  const candidates = [
    `${JENKINS_UPDATE_BASE}/dynamic-${coreVersion}/update-center.actual.json`,
    `${JENKINS_UPDATE_BASE}/current/update-center.actual.json`,
  ]

  let raw: RawUpdateCenter | undefined
  let lastErr: unknown
  for (const url of candidates) {
    try {
      raw = await fetchJson<RawUpdateCenter>(url)
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (!raw) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error('Unable to fetch Jenkins update-center catalogue')
  }

  const plugins: Record<string, UpdateCenterPlugin> = {}
  for (const [name, p] of Object.entries(raw.plugins ?? {})) {
    if (!p.version || !p.url) continue
    plugins[name] = {
      name: p.name ?? name,
      version: p.version,
      url: p.url,
      requiredCore: p.requiredCore ?? '1.0',
      minimumJavaVersion: p.minimumJavaVersion,
      dependencies: p.dependencies,
      size: p.size,
      sha256: p.sha256,
      sha1: p.sha1,
    }
  }

  const matches = raw.core?.version === coreVersion
  return {
    coreVersion: raw.core?.version ?? coreVersion,
    coreVersionMatches: matches,
    coreRequiredJavaVersion: matches ? raw.core?.requiredJavaVersion : undefined,
    plugins,
  }
}

/**
 * Best-effort mapping of core WAR version → minimum Java version.
 *
 * The update-center catalogue carries `core.requiredJavaVersion` for the
 * catalogue's pinned core, but when the user selects a different WAR version
 * we need a standalone answer. This table tracks the publicly announced
 * Java baseline for each line.
 *
 * See: https://www.jenkins.io/doc/book/platform-information/support-policy-java/
 */
const JAVA_BASELINES: Array<{ from: string; minJava: number }> = [
  { from: '2.479', minJava: 17 },
  { from: '2.463', minJava: 17 },
  { from: '2.426', minJava: 11 },
  { from: '2.357', minJava: 11 },
  { from: '2.164', minJava: 8 },
]

export function minimumJavaForCore(coreVersion: string): number {
  for (const row of JAVA_BASELINES) {
    if (compareVersions(coreVersion, row.from) >= 0) return row.minJava
  }
  return 8
}

/** Built WAR download URL for a given core version. Tries the LTS path first. */
export function warDownloadUrls(coreVersion: string): string[] {
  return [
    `${JENKINS_DOWNLOAD_BASE}/war-stable/${coreVersion}/jenkins.war`,
    `${JENKINS_DOWNLOAD_BASE}/war/${coreVersion}/jenkins.war`,
  ]
}

/**
 * Resolves the first WAR URL that returns a 2xx on a HEAD request.
 *
 * `coreVersion` must already be validated with `/^\d+\.\d+(\.\d+)?$/`; this
 * function is only ever called from code paths that have done so.
 */
export async function resolveWarUrl(coreVersion: string): Promise<string | null> {
  for (const url of warDownloadUrls(coreVersion)) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      if (res.ok) return url
    } catch {
      /* try next */
    }
  }
  return null
}
