'use client'

import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode2,
  HelpCircle,
  Loader2,
  Package,
  RefreshCw,
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
import type { JenkinsBundlerResponse, ResolvedPlugin, ResolveResponse } from '@/app/api/tools/jenkins-bundler/route'

type PluginRow = ResolvedPlugin & {
  downloaded: boolean
  downloadError?: string
  downloadedBytes?: number
}

type Report = {
  core: {
    version: string
    warUrl: string | null
  }
  plugins: PluginRow[]
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
    case 'not-found':
      return <Badge variant="secondary">Not found</Badge>
  }
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

export function JenkinsBundler() {
  const [coreVersion, setCoreVersion] = useState('')
  const [pluginsText, setPluginsText] = useState('')
  const [loadingLts, setLoadingLts] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [currentLoaded, setCurrentLoaded] = useState(0)
  const [currentTotal, setCurrentTotal] = useState<number | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const [scriptBundling, setScriptBundling] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalToDownload = useMemo(() => {
    if (!report) return 0
    const compatibleCount = report.plugins.filter((p) => p.status === 'compatible').length
    return compatibleCount + (report.core.warUrl ? 1 : 0)
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

  async function resolve() {
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

    setResolving(true)
    try {
      const data = await postJson<JenkinsBundlerResponse>({
        action: 'resolve',
        coreVersion: coreVersion.trim(),
        plugins: pluginList,
      })
      if (!data.ok) {
        setResolveError(data.error)
        return
      }
      const resolved = data as ResolveResponse
      setReport({
        core: {
          version: resolved.coreVersion,
          warUrl: resolved.warUrl,
        },
        plugins: resolved.plugins.map((p) => ({ ...p, downloaded: false })),
        generatedAt: new Date().toISOString(),
      })
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Failed to resolve plugins')
    } finally {
      setResolving(false)
    }
  }

  async function downloadBundle() {
    if (!report) return
    setDownloadError(null)
    setDownloading(true)
    setDoneCount(0)
    setCurrentFile(null)
    setCurrentLoaded(0)
    setCurrentTotal(null)

    const zip = new JSZip()
    const pluginsFolder = zip.folder('plugins')!
    const updated: PluginRow[] = report.plugins.map((p) => ({ ...p }))

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

      for (let i = 0; i < updated.length; i++) {
        const plugin = updated[i]!
        if (plugin.status !== 'compatible' || !plugin.version) continue
        const filename = `${plugin.name}.hpi`
        setCurrentFile(`plugins/${filename}`)
        setCurrentLoaded(0)
        setCurrentTotal(plugin.size ?? null)
        try {
          const bytes = await fetchWithProgress(
            { kind: 'plugin', name: plugin.name, version: plugin.version },
            (loaded, total) => {
              setCurrentLoaded(loaded)
              setCurrentTotal(total ?? plugin.size ?? null)
            },
          )
          pluginsFolder.file(filename, bytes)
          updated[i] = { ...plugin, downloaded: true, downloadedBytes: bytes.byteLength }
        } catch (err) {
          updated[i] = {
            ...plugin,
            downloaded: false,
            downloadError: err instanceof Error ? err.message : 'Download failed',
          }
        }
        setDoneCount((c) => c + 1)
      }

      const manifest = {
        generatedAt: report.generatedAt,
        core: report.core,
        plugins: updated.map((p) => ({
          name: p.name,
          version: p.version ?? null,
          status: p.status,
          reason: p.reason ?? null,
          requiredCore: p.requiredCore ?? null,
          downloaded: p.downloaded,
          downloadError: p.downloadError ?? null,
          sha256: p.sha256 ?? null,
        })),
      }
      zip.file('bundle-manifest.json', JSON.stringify(manifest, null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jenkins-${report.core.version}-bundle.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setReport({ ...report, plugins: updated })
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
      setCurrentFile(null)
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
      for (const p of report.plugins) {
        if (p.status !== 'compatible' || !p.url) continue
        manifestLines.push(`${p.url}\tplugins/${p.name}.hpi`)
      }

      const bundleManifest = {
        generatedAt: report.generatedAt,
        core: report.core,
        plugins: report.plugins.map((p) => ({
          name: p.name,
          version: p.version ?? null,
          status: p.status,
          reason: p.reason ?? null,
          requiredCore: p.requiredCore ?? null,
          sha256: p.sha256 ?? null,
        })),
      }

      zip.file('manifest.tsv', manifestLines.join('\n') + '\n')
      // unixPermissions 0o755 makes the script executable when extracted on
      // Linux/macOS — without it the user has to remember `chmod +x`.
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

  const compatibleCount = report?.plugins.filter((p) => p.status === 'compatible').length ?? 0
  const incompatibleCount = (report?.plugins.length ?? 0) - compatibleCount

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
              <Button type="button" onClick={resolve} disabled={resolving || downloading}>
                {resolving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
                Resolve compatibility
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
                onClick={downloadScriptBundle}
                disabled={!report || downloading || scriptBundling || totalToDownload === 0}
                variant="outline"
                title="Download a small zip containing a manifest of URLs and a shell script that fetches them — for hosts where ct-ops can't download binaries itself."
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

        {report && <ReportCard report={report} compatibleCount={compatibleCount} incompatibleCount={incompatibleCount} />}
      </div>

      <div className="space-y-6">
        <HelpCard />
      </div>
    </div>
  )
}

function ReportCard({
  report,
  compatibleCount,
  incompatibleCount,
}: {
  report: Report
  compatibleCount: number
  incompatibleCount: number
}) {
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

        {report.plugins.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge className="bg-emerald-600 hover:bg-emerald-600">{compatibleCount} compatible</Badge>
            {incompatibleCount > 0 && <Badge variant="destructive">{incompatibleCount} incompatible / missing</Badge>}
          </div>
        )}

        {report.plugins.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No plugins requested — the bundle will contain just the WAR file.
          </p>
        )}

        {report.plugins.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plugin</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Needs core</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.plugins.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-mono text-xs">{p.name}</TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.version ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{p.requiredCore ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatBytes(p.size)}</TableCell>
                  <TableCell>
                    {p.downloaded ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="size-3.5" /> Ok
                      </span>
                    ) : p.downloadError ? (
                      <span className="flex items-center gap-1 text-xs text-destructive" title={p.downloadError}>
                        <XCircle className="size-3.5" /> Failed
                      </span>
                    ) : p.reason ? (
                      <span className="text-xs text-muted-foreground" title={p.reason}>
                        Skipped
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Pending</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </CardContent>
    </Card>
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
