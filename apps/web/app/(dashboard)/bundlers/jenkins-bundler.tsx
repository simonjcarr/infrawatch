'use client'

import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode2,
  HelpCircle,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  JenkinsBundlerResponse,
  ResolvedPlugin,
  ResolvedPluginNode,
  ResolveResponse,
} from '@/app/api/tools/jenkins-bundler/route'
import { BundleTransferDialog, type TransferBundle, type TransferJobStatus } from './bundle-transfer-dialog'
import { BundleTransferStatus } from './bundle-transfer-status'

type PluginRow = ResolvedPlugin & {
  downloaded: boolean
  downloading?: boolean
  downloadError?: string
  downloadedBytes?: number
}

type PluginNodeRow = ResolvedPluginNode & {
  downloaded?: boolean
  downloading?: boolean
  downloadError?: string
  downloadedBytes?: number
}

type Report = {
  core: {
    version: string
    minimumJava: number | null
    javaSource: 'updates.jenkins.io' | 'unavailable'
    javaCompatible: boolean | null
    warUrl: string | null
  }
  plugins: PluginNodeRow[]
  transitivePlugins: PluginRow[]
  // True iff the user resolved with the "include dependencies" toggle on. The
  // tree UI is shown only when this is true; otherwise the original flat
  // table renders unchanged.
  includesTransitive: boolean
  generatedAt: string
}

async function postJson<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/tools/jenkins-bundler', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T
  return data
}

type ProxyTarget =
  | { kind: 'war'; version: string }
  | { kind: 'plugin'; name: string; version: string }

/**
 * Streams an asset via the server proxy and reports progress. We send kind +
 * identifiers (not a full URL) so the server can build the download URL from
 * trusted templates — this is what keeps the proxy from being SSRF-able.
 */
async function fetchWithProgress(
  target: ProxyTarget,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  const qs = new URLSearchParams(
    target.kind === 'war'
      ? { kind: 'war', version: target.version }
      : { kind: 'plugin', name: target.name, version: target.version },
  )
  const proxied = `/api/tools/jenkins-bundler?${qs.toString()}`
  const res = await fetch(proxied, { cache: 'no-store' })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status})`)
  }
  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? parseInt(totalHeader, 10) : null

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.byteLength
      onProgress(loaded, total)
    }
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function formatBytes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function statusBadge(status: ResolvedPlugin['status']) {
  switch (status) {
    case 'compatible':
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Compatible</Badge>
    case 'core-incompatible':
      return <Badge variant="destructive">Core incompatible</Badge>
    case 'java-incompatible':
      return <Badge variant="destructive">Java incompatible</Badge>
    case 'not-found':
      return <Badge variant="secondary">Not found</Badge>
  }
}

function byPluginName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function sortPlugins<T extends { name: string }>(plugins: T[]): T[] {
  return [...plugins].sort(byPluginName)
}

function sortPluginNodes(nodes: ResolvedPluginNode[]): ResolvedPluginNode[] {
  return sortPlugins(nodes).map((node) => ({
    ...node,
    dependencies: node.dependencies ? sortPluginNodes(node.dependencies) : node.dependencies,
  }))
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Bash script bundled into the offline-script zip. Reads manifest.tsv and
// downloads each entry, then zips them up so the final archive matches what
// the in-browser "Download bundle" button would produce.
const FETCH_BUNDLE_SH = `#!/usr/bin/env bash
# Downloads the Jenkins WAR + plugins listed in manifest.tsv and packages
# them into jenkins-bundle.zip. Run this on a host with internet access; copy
# the resulting zip to your air-gapped target. Requires bash, curl, zip.
set -euo pipefail

cd "$(dirname "$0")"

for cmd in curl zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: $cmd is required but not installed" >&2
    exit 1
  fi
done

manifest="manifest.tsv"
build="build"
output="jenkins-bundle.zip"

[ -f "$manifest" ] || { echo "error: $manifest not found" >&2; exit 1; }

rm -rf "$build" "$output"
mkdir -p "$build"

if [ -f bundle-manifest.json ]; then
  cp bundle-manifest.json "$build/"
fi

total=$(grep -cv '^[[:space:]]*\\(#\\|$\\)' "$manifest" || true)
i=0

while IFS=$'\\t' read -r url dest; do
  case "\${url:-}" in '#'*|'') continue ;; esac
  if [ -z "\${dest:-}" ]; then
    echo "error: malformed manifest line (missing destination): $url" >&2
    exit 1
  fi
  i=$((i+1))
  printf '[%d/%d] %s\\n' "$i" "$total" "$dest"
  mkdir -p "$build/$(dirname "$dest")"
  curl --fail --location --retry 3 --retry-connrefused -sS \\
    -o "$build/$dest" "$url"
done < "$manifest"

(cd "$build" && zip -r -q "../$output" .)
echo "Created: $output"
`

const OFFLINE_README = `Jenkins air-gap bundle — offline script

Generated by ct-ops's Jenkins air-gap bundler. Use this when the ct-ops
server can't reach updates.jenkins.io / get.jenkins.io directly (low
bandwidth, no egress, etc.) and you'd rather fetch the binaries from
elsewhere.

Files in this zip:
  manifest.tsv         <url> TAB <destination> per file (one per line).
  fetch-bundle.sh      Runs through manifest.tsv and produces jenkins-bundle.zip.
  bundle-manifest.json Plugin metadata (versions, sha256, status).
  README.txt           This file.

Usage:
  1. Unzip on a host with internet access (workstation, jump box, etc.).
  2. Run: ./fetch-bundle.sh
  3. Move the resulting jenkins-bundle.zip to your air-gapped target.

The output zip has the same layout as ct-ops's "Download bundle":
  jenkins.war
  plugins/<name>.hpi
  bundle-manifest.json

Requirements: bash, curl, zip (all standard on Linux/macOS).
`

const LINUX_SNIPPET = `# Using the Jenkins REST API (requires jq). JENKINS_URL / JENKINS_USER /
# JENKINS_TOKEN are an admin URL and API token. Prints one plugin short name
# per line.
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" \\
  "$JENKINS_URL/pluginManager/api/json?depth=1&tree=plugins[shortName]" \\
  | jq -r '.plugins[].shortName'
`

const WINDOWS_SNIPPET = `# PowerShell equivalent. $JenkinsUrl / $JenkinsUser / $JenkinsToken should
# point at an admin-capable API token. Prints one plugin short name per line.
$pair  = "$($JenkinsUser):$($JenkinsToken)"
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{ Authorization = "Basic $basic" }
(Invoke-RestMethod -Headers $headers \`
  -Uri "$JenkinsUrl/pluginManager/api/json?depth=1&tree=plugins[shortName]"
).plugins | ForEach-Object { $_.shortName }
`

const GROOVY_SNIPPET = `// Paste into Manage Jenkins → Script Console. Prints one plugin short name
// per line to the output pane.
Jenkins.instance.pluginManager.plugins
  .collect { it.shortName }
  .sort()
  .each { println it }
`

export function JenkinsBundler({ orgId }: { orgId: string }) {
  const [coreVersion, setCoreVersion] = useState('')
  const [javaVersion, setJavaVersion] = useState<string>('')
  const [pluginsText, setPluginsText] = useState('')
  const [loadingLts, setLoadingLts] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolvingMode, setResolvingMode] = useState<'flat' | 'deps' | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [currentLoaded, setCurrentLoaded] = useState(0)
  const [currentTotal, setCurrentTotal] = useState<number | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const [scriptBundling, setScriptBundling] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferJob, setTransferJob] = useState<TransferJobStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalToDownload = useMemo(() => {
    if (!report) return 0
    const topCompat = report.plugins.filter((p) => p.status === 'compatible').length
    const transitiveCompat = report.transitivePlugins.filter((p) => p.status === 'compatible').length
    return topCompat + transitiveCompat + (report.core.warUrl ? 1 : 0)
  }, [report])

  const overallPct = useMemo(() => {
    if (!downloading || totalToDownload === 0) return 0
    const perFile = currentTotal && currentTotal > 0 ? currentLoaded / currentTotal : 0
    return Math.min(100, ((doneCount + perFile) / totalToDownload) * 100)
  }, [downloading, totalToDownload, doneCount, currentLoaded, currentTotal])

  async function fetchLatestLts() {
    setLoadingLts(true)
    setResolveError(null)
    try {
      const data = await postJson<JenkinsBundlerResponse>({ action: 'latest-lts' })
      if (!data.ok) {
        setResolveError(data.error)
        return
      }
      if ('version' in data) setCoreVersion(data.version)
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Failed to fetch latest LTS')
    } finally {
      setLoadingLts(false)
    }
  }

  function onPluginFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setPluginsText((prev) => (prev.trim().length > 0 ? `${prev.trim()}\n${text}` : text))
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  async function resolve(includeTransitiveDeps: boolean) {
    setResolveError(null)
    setReport(null)
    setDownloadError(null)
    // Empty plugin list is allowed — bundling just the WAR is a valid use.
    const pluginList = pluginsText
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'))
    if (!/^\d+\.\d+(\.\d+)?$/.test(coreVersion.trim())) {
      setResolveError('Enter a valid Jenkins core version, e.g. 2.462.3')
      return
    }

    const javaNum = javaVersion.trim() ? parseInt(javaVersion.trim(), 10) : undefined
    if (javaVersion.trim() && (!Number.isFinite(javaNum) || (javaNum as number) <= 0)) {
      setResolveError('Java version must be a positive integer (e.g. 11, 17, 21)')
      return
    }

    setResolving(true)
    setResolvingMode(includeTransitiveDeps ? 'deps' : 'flat')
    try {
      const data = await postJson<JenkinsBundlerResponse>({
        action: 'resolve',
        coreVersion: coreVersion.trim(),
        plugins: pluginList,
        javaVersion: javaNum,
        includeTransitiveDeps,
      })
      if (!data.ok) {
        setResolveError(data.error)
        return
      }
      const resolved = data as ResolveResponse
      const plugins = sortPluginNodes(resolved.plugins)
      const transitivePlugins = sortPlugins(resolved.transitivePlugins)
      setReport({
        core: {
          version: resolved.coreVersion,
          minimumJava: resolved.coreMinimumJava,
          javaSource: resolved.coreJavaSource,
          javaCompatible: resolved.javaCompatible,
          warUrl: resolved.warUrl,
        },
        plugins,
        transitivePlugins: transitivePlugins.map((p) => ({ ...p, downloaded: false })),
        includesTransitive: includeTransitiveDeps,
        generatedAt: new Date().toISOString(),
      })
      // Pre-expand top-level plugins so the tree opens to its first level by
      // default — saves a click and makes it obvious deps are there.
      setExpanded(new Set(plugins.map((p) => `/${p.name}`)))
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Failed to resolve plugins')
    } finally {
      setResolving(false)
      setResolvingMode(null)
    }
  }

  async function buildJenkinsBundle(): Promise<{ blob: Blob; fileName: string }> {
    if (!report) throw new Error('Resolve a bundle before transferring')
    setDownloadError(null)
    setDownloading(true)
    setDoneCount(0)
    setCurrentFile(null)
    setCurrentLoaded(0)
    setCurrentTotal(null)

    const zip = new JSZip()
    const pluginsFolder = zip.folder('plugins')!
    const updatedTop: PluginNodeRow[] = report.plugins.map((p) => ({
      ...p,
      downloaded: false,
      downloading: false,
      downloadError: undefined,
      downloadedBytes: undefined,
    }))
    const updatedTransitive: PluginRow[] = report.transitivePlugins.map((p) => ({
      ...p,
      downloaded: false,
      downloading: false,
      downloadError: undefined,
      downloadedBytes: undefined,
    }))

    const commitDownloadState = () => {
      setReport({
        ...report,
        plugins: updatedTop.map((p) => ({ ...p })),
        transitivePlugins: updatedTransitive.map((p) => ({ ...p })),
      })
    }

    commitDownloadState()

    try {
      if (report.core.warUrl) {
        setCurrentFile('jenkins.war')
        const bytes = await fetchWithProgress(
          { kind: 'war', version: report.core.version },
          (loaded, total) => {
            setCurrentLoaded(loaded)
            setCurrentTotal(total)
          },
        )
        zip.file('jenkins.war', bytes)
        setDoneCount((c) => c + 1)
      }

      // Single alphabetised download list across top-level requested plugins
      // and transitive deps. Defensive dedup by lowercased name in case a
      // requested plugin was also reachable transitively (the API contract
      // already excludes that, but the cost of a Set guard is trivial).
      const seen = new Set<string>()
      const downloadList: Array<{
        kind: 'top' | 'transitive'
        index: number
        name: string
        version: string
        size: number | null
      }> = []

      for (let i = 0; i < updatedTop.length; i++) {
        const p = updatedTop[i]!
        if (p.status !== 'compatible' || !p.version) continue
        const key = p.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        downloadList.push({ kind: 'top', index: i, name: p.name, version: p.version, size: p.size ?? null })
      }
      for (let i = 0; i < updatedTransitive.length; i++) {
        const p = updatedTransitive[i]!
        if (p.status !== 'compatible' || !p.version) continue
        const key = p.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        downloadList.push({ kind: 'transitive', index: i, name: p.name, version: p.version, size: p.size ?? null })
      }
      downloadList.sort(byPluginName)

      for (const item of downloadList) {
        const filename = `${item.name}.hpi`
        setCurrentFile(`plugins/${filename}`)
        setCurrentLoaded(0)
        setCurrentTotal(item.size)
        if (item.kind === 'top') {
          updatedTop[item.index] = {
            ...updatedTop[item.index]!,
            downloading: true,
            downloaded: false,
            downloadError: undefined,
            downloadedBytes: undefined,
          }
        } else {
          updatedTransitive[item.index] = {
            ...updatedTransitive[item.index]!,
            downloading: true,
            downloaded: false,
            downloadError: undefined,
            downloadedBytes: undefined,
          }
        }
        commitDownloadState()
        try {
          const bytes = await fetchWithProgress(
            { kind: 'plugin', name: item.name, version: item.version },
            (loaded, total) => {
              setCurrentLoaded(loaded)
              setCurrentTotal(total ?? item.size)
            },
          )
          pluginsFolder.file(filename, bytes)
          if (item.kind === 'top') {
            updatedTop[item.index] = {
              ...updatedTop[item.index]!,
              downloaded: true,
              downloading: false,
              downloadedBytes: bytes.byteLength,
            }
          } else {
            updatedTransitive[item.index] = {
              ...updatedTransitive[item.index]!,
              downloaded: true,
              downloading: false,
              downloadedBytes: bytes.byteLength,
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Download failed'
          if (item.kind === 'top') {
            updatedTop[item.index] = {
              ...updatedTop[item.index]!,
              downloaded: false,
              downloading: false,
              downloadError: msg,
            }
          } else {
            updatedTransitive[item.index] = {
              ...updatedTransitive[item.index]!,
              downloaded: false,
              downloading: false,
              downloadError: msg,
            }
          }
        }
        commitDownloadState()
        setDoneCount((c) => c + 1)
      }

      const manifest = {
        generatedAt: report.generatedAt,
        core: report.core,
        includesTransitive: report.includesTransitive,
        plugins: updatedTop.map((p) => ({
          name: p.name,
          version: p.version ?? null,
          status: p.status,
          reason: p.reason ?? null,
          requiredCore: p.requiredCore ?? null,
          minimumJavaVersion: p.minimumJavaVersion ?? null,
          downloaded: p.downloaded ?? false,
          downloadError: p.downloadError ?? null,
          sha256: p.sha256 ?? null,
        })),
        transitivePlugins: updatedTransitive.map((p) => ({
          name: p.name,
          version: p.version ?? null,
          status: p.status,
          reason: p.reason ?? null,
          requiredCore: p.requiredCore ?? null,
          minimumJavaVersion: p.minimumJavaVersion ?? null,
          downloaded: p.downloaded ?? false,
          downloadError: p.downloadError ?? null,
          sha256: p.sha256 ?? null,
        })),
        // Self-documenting: the full tree (with `dependencies`, `origin`,
        // cycle markers, etc.) so the bundle records *why* each .hpi is here.
        dependencyTree: report.plugins,
      }
      zip.file('bundle-manifest.json', JSON.stringify(manifest, null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })

      commitDownloadState()
      return {
        blob,
        fileName: `jenkins-${report.core.version}-bundle.zip`,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Download failed'
      setDownloadError(message)
      throw new Error(message)
    } finally {
      setDownloading(false)
      setCurrentFile(null)
    }
  }

  async function downloadBundle() {
    try {
      const bundle = await buildJenkinsBundle()
      downloadBlob(bundle.blob, bundle.fileName)
    } catch {
      // buildJenkinsBundle already surfaced the error in the bundler panel.
    }
  }

  function buildTransferBundle(): TransferBundle {
    if (!report) throw new Error('Resolve a bundle before transferring')
    return {
      fileName: `jenkins-${report.core.version}-bundle.zip`,
      payload: {
        kind: 'jenkins',
        generatedAt: report.generatedAt,
        core: report.core,
        includesTransitive: report.includesTransitive,
        plugins: report.plugins.map((plugin) => ({
          name: plugin.name,
          requested: plugin.requested,
          status: plugin.status,
          version: plugin.version,
          requiredCore: plugin.requiredCore,
          minimumJavaVersion: plugin.minimumJavaVersion,
          size: plugin.size,
          sha256: plugin.sha256,
          reason: plugin.reason,
        })),
        transitivePlugins: report.transitivePlugins.map((plugin) => ({
          name: plugin.name,
          requested: plugin.requested,
          status: plugin.status,
          version: plugin.version,
          requiredCore: plugin.requiredCore,
          minimumJavaVersion: plugin.minimumJavaVersion,
          size: plugin.size,
          sha256: plugin.sha256,
          reason: plugin.reason,
        })),
        dependencyTree: report.plugins,
      },
    }
  }

  async function downloadScriptBundle() {
    if (!report) return
    setDownloadError(null)
    setScriptBundling(true)
    try {
      const zip = new JSZip()
      const manifestLines: string[] = [
        '# Generated by ct-ops Jenkins air-gap bundler',
        `# Core: ${report.core.version}    Generated: ${report.generatedAt}`,
        '# Format: <url><TAB><destination path inside the bundle zip>',
      ]
      if (report.core.warUrl) {
        manifestLines.push(`${report.core.warUrl}\tjenkins.war`)
      }

      const seen = new Set<string>()
      for (const p of sortPlugins([...report.plugins, ...report.transitivePlugins])) {
        if (p.status !== 'compatible' || !p.url) continue
        const key = p.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        manifestLines.push(`${p.url}\tplugins/${p.name}.hpi`)
      }

      const bundleManifest = {
        generatedAt: report.generatedAt,
        core: report.core,
        includesTransitive: report.includesTransitive,
        plugins: report.plugins.map((p) => ({
          name: p.name,
          version: p.version ?? null,
          status: p.status,
          reason: p.reason ?? null,
          requiredCore: p.requiredCore ?? null,
          minimumJavaVersion: p.minimumJavaVersion ?? null,
          sha256: p.sha256 ?? null,
        })),
        transitivePlugins: report.transitivePlugins.map((p) => ({
          name: p.name,
          version: p.version ?? null,
          status: p.status,
          reason: p.reason ?? null,
          requiredCore: p.requiredCore ?? null,
          minimumJavaVersion: p.minimumJavaVersion ?? null,
          sha256: p.sha256 ?? null,
        })),
        dependencyTree: report.plugins,
      }

      zip.file('manifest.tsv', manifestLines.join('\n') + '\n')
      // unixPermissions 0o755 makes the script executable when extracted on
      // Linux/macOS.
      zip.file('fetch-bundle.sh', FETCH_BUNDLE_SH, { unixPermissions: 0o755 })
      zip.file('bundle-manifest.json', JSON.stringify(bundleManifest, null, 2))
      zip.file('README.txt', OFFLINE_README)

      const blob = await zip.generateAsync({ type: 'blob', platform: 'UNIX' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jenkins-${report.core.version}-offline-script.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Failed to build offline script bundle')
    } finally {
      setScriptBundling(false)
    }
  }

  // Counts span both top-level requested plugins and (when the toggle was on)
  // their resolved transitive deps — `incompatibleCount` reflects everything
  // the user might want to look at, not just the listed names.
  const topCompatible = report?.plugins.filter((p) => p.status === 'compatible').length ?? 0
  const topIncompatible = (report?.plugins.length ?? 0) - topCompatible
  const transitiveCompatible = report?.transitivePlugins.filter((p) => p.status === 'compatible').length ?? 0
  const compatibleCount = topCompatible + transitiveCompatible
  const incompatibleCount = topIncompatible

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4" /> Jenkins WAR &amp; plugins
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="core-version">Jenkins WAR version</Label>
                <div className="flex gap-2">
                  <Input
                    id="core-version"
                    placeholder="e.g. 2.462.3"
                    value={coreVersion}
                    onChange={(e) => setCoreVersion(e.target.value)}
                    disabled={resolving || downloading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={fetchLatestLts}
                    disabled={loadingLts || resolving || downloading}
                    title="Fetch latest LTS version"
                  >
                    {loadingLts ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    <span className="ml-1.5 hidden sm:inline">Latest LTS</span>
                  </Button>
                </div>
              </div>
              <div className="hidden items-end sm:flex" />
              <div className="space-y-1.5">
                <Label htmlFor="java-version">
                  Your Java version <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="java-version"
                  placeholder="e.g. 17"
                  inputMode="numeric"
                  value={javaVersion}
                  onChange={(e) => setJavaVersion(e.target.value)}
                  disabled={resolving || downloading}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="plugins">Plugin list</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={resolving || downloading}
                >
                  <Upload className="mr-1.5 size-3.5" /> Upload file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,.list,text/plain"
                  className="hidden"
                  onChange={onPluginFile}
                />
              </div>
              <Textarea
                id="plugins"
                placeholder={'One plugin short name per line, e.g.\ngit\ncredentials\nworkflow-aggregator\n…\n\n(Leave blank to bundle just the WAR.)'}
                value={pluginsText}
                onChange={(e) => setPluginsText(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                disabled={resolving || downloading}
              />
              <p className="text-xs text-muted-foreground">
                Use the plugin <em>short name</em> (not the display name). Lines beginning with <code>#</code> are ignored,
                and <code>name:version</code> pins are tolerated but the latest compatible version is always selected.
                Leave the field empty to bundle just the WAR file.
              </p>
            </div>

            {resolveError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>Unable to resolve plugins</AlertTitle>
                <AlertDescription>{resolveError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => resolve(false)} disabled={resolving || downloading}>
                {resolving && resolvingMode === 'flat' ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 size-4" />
                )}
                Resolve compatibility
              </Button>
              <Button
                type="button"
                onClick={() => resolve(true)}
                disabled={resolving || downloading}
                variant="outline"
                title="Resolve the listed plugins and recursively add their required dependencies to the bundle."
              >
                {resolving && resolvingMode === 'deps' ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Package className="mr-1.5 size-4" />
                )}
                Pull dependencies
              </Button>
              <Button
                type="button"
                onClick={downloadBundle}
                disabled={!report || downloading || scriptBundling || totalToDownload === 0}
                variant="default"
              >
                {downloading ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Download className="mr-1.5 size-4" />
                )}
                Download bundle
              </Button>
              <Button
                type="button"
                onClick={() => setTransferOpen(true)}
                disabled={!report || downloading || scriptBundling || totalToDownload === 0}
                variant="outline"
              >
                <Send className="mr-1.5 size-4" />
                Transfer bundle
              </Button>
              <Button
                type="button"
                onClick={downloadScriptBundle}
                disabled={!report || downloading || scriptBundling || totalToDownload === 0}
                variant="outline"
                title="Download a small zip containing a manifest of URLs and a shell script that fetches them."
              >
                {scriptBundling ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <FileCode2 className="mr-1.5 size-4" />
                )}
                Download offline script
              </Button>
            </div>
          </CardContent>
        </Card>

        {downloading && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Downloading</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{currentFile ?? 'Preparing…'}</span>
                  <span>
                    {formatBytes(currentLoaded)}
                    {currentTotal ? ` / ${formatBytes(currentTotal)}` : ''}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-150"
                    style={{ width: `${currentTotal && currentTotal > 0 ? Math.min(100, (currentLoaded / currentTotal) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Overall</span>
                  <span>
                    {doneCount} / {totalToDownload}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-emerald-600 transition-[width] duration-150"
                    style={{ width: `${overallPct}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {downloadError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Download failed</AlertTitle>
            <AlertDescription>{downloadError}</AlertDescription>
          </Alert>
        )}

        {report && (
          <ReportCard
            report={report}
            compatibleCount={compatibleCount}
            incompatibleCount={incompatibleCount}
            transitiveCount={transitiveCompatible}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
          />
        )}
        <BundleTransferStatus job={transferJob} onJobChange={setTransferJob} />
      </div>

      <div className="space-y-6">
        <HelpCard />
      </div>
      <BundleTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        orgId={orgId}
        buildBundle={buildTransferBundle}
        onTransferStarted={setTransferJob}
      />
    </div>
  )
}

function ReportCard({
  report,
  compatibleCount,
  incompatibleCount,
  transitiveCount,
  expanded,
  toggleExpanded,
}: {
  report: Report
  compatibleCount: number
  incompatibleCount: number
  transitiveCount: number
  expanded: Set<string>
  toggleExpanded: (key: string) => void
}) {
  const javaOk = report.core.javaCompatible
  const downloadStateByName = useMemo(() => {
    const state = new Map<string, PluginNodeRow | PluginRow>()
    for (const plugin of report.transitivePlugins) state.set(plugin.name.toLowerCase(), plugin)
    for (const plugin of report.plugins) state.set(plugin.name.toLowerCase(), plugin)
    return state
  }, [report.plugins, report.transitivePlugins])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compatibility report</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Core version: </span>
            <span className="font-mono">{report.core.version}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Minimum Java for WAR: </span>
            {report.core.minimumJava != null ? (
              <>
                <span className="font-mono">Java {report.core.minimumJava}+</span>{' '}
                <span className="text-xs text-muted-foreground">(from updates.jenkins.io)</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                Could not determine — updates.jenkins.io has no catalogue for this WAR
              </span>
            )}
          </div>
          <div className="sm:col-span-2">
            <span className="text-muted-foreground">WAR download: </span>
            {report.core.warUrl ? (
              <a href={report.core.warUrl} className="break-all font-mono text-primary underline" target="_blank" rel="noreferrer">
                {report.core.warUrl}
              </a>
            ) : (
              <span className="text-destructive">Not available for this version</span>
            )}
          </div>
        </div>

        {javaOk === false && report.core.minimumJava != null && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Java version is too old for this WAR</AlertTitle>
            <AlertDescription>
              Jenkins {report.core.version} requires Java {report.core.minimumJava} or newer.
            </AlertDescription>
          </Alert>
        )}
        {javaOk === true && report.core.minimumJava != null && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>Java version looks compatible</AlertTitle>
            <AlertDescription>
              Jenkins {report.core.version} needs Java {report.core.minimumJava}+; you specified a compatible version.
            </AlertDescription>
          </Alert>
        )}
        {report.core.javaSource === 'unavailable' && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>Java compatibility could not be checked</AlertTitle>
            <AlertDescription>
              updates.jenkins.io did not return a catalogue for Jenkins {report.core.version}, so
              we can&apos;t confirm the minimum Java version. Check{' '}
              <a
                href="https://www.jenkins.io/doc/book/platform-information/support-policy-java/"
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                jenkins.io&apos;s Java support policy
              </a>{' '}
              before deploying this WAR.
            </AlertDescription>
          </Alert>
        )}

        {report.plugins.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge className="bg-emerald-600 hover:bg-emerald-600">{compatibleCount} compatible</Badge>
            {incompatibleCount > 0 && <Badge variant="destructive">{incompatibleCount} incompatible / missing</Badge>}
            {report.includesTransitive && (
              <Badge variant="secondary">
                {transitiveCount} transitive {transitiveCount === 1 ? 'dependency' : 'dependencies'}
              </Badge>
            )}
          </div>
        )}

        {report.plugins.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No plugins requested — the bundle will contain just the WAR file.
          </p>
        )}

        {report.plugins.length > 0 && !report.includesTransitive && (
          <FlatPluginsTable plugins={report.plugins} />
        )}

        {report.plugins.length > 0 && report.includesTransitive && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Requested plugins</div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plugin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Needs core</TableHead>
                    <TableHead>Min Java</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.plugins.map((node) => (
                    <PluginTreeRow
                      key={node.name}
                      node={node}
                      depth={0}
                      parentPath=""
                      expanded={expanded}
                      toggle={toggleExpanded}
                      downloadStateByName={downloadStateByName}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Click a row with a chevron to expand its dependencies. Optional dependencies are shown for context but
              not pulled into the bundle.
            </p>
          </div>
        )}

        {report.includesTransitive && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              All dependencies that will be added ({report.transitivePlugins.length})
            </div>
            {report.transitivePlugins.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plugin</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Needs core</TableHead>
                      <TableHead>Min Java</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Download</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.transitivePlugins.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-mono text-xs">{p.name}</TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                        <TableCell className="font-mono text-xs">{p.version ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{p.requiredCore ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{p.minimumJavaVersion ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatBytes(p.size)}</TableCell>
                        <TableCell>{downloadStateCell(p)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                No required dependencies will be added for this plugin list.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Original flat table — preserved verbatim for the toggle-off path so existing
 * users see zero change.
 */
function FlatPluginsTable({ plugins }: { plugins: PluginNodeRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plugin</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Needs core</TableHead>
            <TableHead>Min Java</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plugins.map((p) => (
            <TableRow key={p.name}>
              <TableCell className="font-mono text-xs">{p.name}</TableCell>
              <TableCell>{statusBadge(p.status)}</TableCell>
              <TableCell className="font-mono text-xs">{p.version ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{p.requiredCore ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{p.minimumJavaVersion ?? '—'}</TableCell>
              <TableCell className="text-right font-mono text-xs">{formatBytes(p.size)}</TableCell>
              <TableCell>{downloadStateCell(p)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function downloadStateCell(p: { downloaded?: boolean; downloading?: boolean; downloadError?: string; reason?: string }) {
  if (p.downloading) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Downloading
      </span>
    )
  }
  if (p.downloaded) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="size-3.5" /> Ok
      </span>
    )
  }
  if (p.downloadError) {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={p.downloadError}>
        <XCircle className="size-3.5" /> Failed
      </span>
    )
  }
  if (p.reason) {
    return (
      <span className="text-xs text-muted-foreground" title={p.reason}>
        Skipped
      </span>
    )
  }
  return <span className="text-xs text-muted-foreground">Pending</span>
}

/**
 * Recursively renders one plugin row plus, when expanded, its dependency rows.
 *
 * Expansion is keyed by the full path from the root (`/git/scm-api/...`) so the
 * same plugin name appearing under two different parents toggles independently.
 * A node is expandable iff it has a populated `dependencies` array — optional
 * deps and cycle/already-listed leaves render without a chevron.
 */
function PluginTreeRow({
  node,
  depth,
  parentPath,
  expanded,
  toggle,
  downloadStateByName,
}: {
  node: ResolvedPluginNode
  depth: number
  parentPath: string
  expanded: Set<string>
  toggle: (key: string) => void
  downloadStateByName: Map<string, PluginNodeRow | PluginRow>
}) {
  const path = `${parentPath}/${node.name}`
  const hasChildren = !!node.dependencies && node.dependencies.length > 0
  const isOpen = hasChildren && expanded.has(path)
  const downloadState = downloadStateByName.get(node.name.toLowerCase())
    ?? (node.origin === 'optional-dep' ? { ...node, reason: node.reason ?? 'Optional dependency is not pulled into the bundle' } : node)

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(path)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={isOpen ? 'Collapse' : 'Expand'}
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
              </button>
            ) : (
              <span className="inline-block w-[18px]" />
            )}
            <span>{node.name}</span>
            {node.origin === 'optional-dep' && (
              <Badge variant="outline" className="ml-1 text-[10px] font-normal text-muted-foreground">
                Optional
              </Badge>
            )}
            {node.cycle && (
              <Badge variant="outline" className="ml-1 text-[10px] font-normal text-muted-foreground">
                Cycle
              </Badge>
            )}
            {node.alreadyListed && (
              <Badge variant="outline" className="ml-1 text-[10px] font-normal text-muted-foreground">
                Already listed
              </Badge>
            )}
            {node.requiredByVersion && depth > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                (parent wants v{node.requiredByVersion})
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>{statusBadge(node.status)}</TableCell>
        <TableCell className="font-mono text-xs">{node.version ?? '—'}</TableCell>
        <TableCell className="font-mono text-xs">{node.requiredCore ?? '—'}</TableCell>
        <TableCell className="font-mono text-xs">{node.minimumJavaVersion ?? '—'}</TableCell>
        <TableCell className="text-right font-mono text-xs">{formatBytes(node.size)}</TableCell>
        <TableCell>{downloadStateCell(downloadState)}</TableCell>
      </TableRow>
      {isOpen
        && node.dependencies?.map((child) => (
          <PluginTreeRow
            key={`${path}/${child.name}`}
            node={child}
            depth={depth + 1}
            parentPath={path}
            expanded={expanded}
            toggle={toggle}
            downloadStateByName={downloadStateByName}
          />
        ))}
    </>
  )
}

function HelpCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="size-4" /> Listing your installed plugins
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Paste one of the following into your shell (or the Jenkins Script Console) on your existing Jenkins server to
          produce a plugin list, one short name per line. Pipe the output into this tool.
        </p>
        <Tabs defaultValue="linux" className="w-full">
          <TabsList>
            <TabsTrigger value="linux">
              <FileCode2 className="mr-1.5 size-3.5" /> Linux
            </TabsTrigger>
            <TabsTrigger value="windows">
              <FileCode2 className="mr-1.5 size-3.5" /> Windows
            </TabsTrigger>
            <TabsTrigger value="groovy">
              <FileCode2 className="mr-1.5 size-3.5" /> Script Console
            </TabsTrigger>
          </TabsList>
          <TabsContent value="linux" className="mt-3">
            <CodeBlock code={LINUX_SNIPPET} />
          </TabsContent>
          <TabsContent value="windows" className="mt-3">
            <CodeBlock code={WINDOWS_SNIPPET} />
          </TabsContent>
          <TabsContent value="groovy" className="mt-3">
            <CodeBlock code={GROOVY_SNIPPET} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-2 top-2"
        onClick={copy}
      >
        {copied ? <CheckCircle2 className="size-3.5" /> : <FileCode2 className="size-3.5" />}
        <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  )
}
