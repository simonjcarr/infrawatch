'use client'

import { useMemo, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  Search,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { GitLabBundleStep, GitLabBundlerResponse } from '@/app/api/tools/gitlab-bundler/route'

const OS_OPTIONS = [
  { value: 'ubuntu-noble', label: 'Ubuntu 24.04 Noble', kind: 'deb', arches: ['amd64', 'arm64'] },
  { value: 'ubuntu-jammy', label: 'Ubuntu 22.04 Jammy', kind: 'deb', arches: ['amd64', 'arm64'] },
  { value: 'ubuntu-focal', label: 'Ubuntu 20.04 Focal', kind: 'deb', arches: ['amd64', 'arm64'] },
  { value: 'debian-bookworm', label: 'Debian 12 Bookworm', kind: 'deb', arches: ['amd64', 'arm64'] },
  { value: 'debian-bullseye', label: 'Debian 11 Bullseye', kind: 'deb', arches: ['amd64', 'arm64'] },
  { value: 'el-9', label: 'RHEL/Rocky/Alma 9', kind: 'rpm', arches: ['x86_64', 'aarch64'] },
  { value: 'el-8', label: 'RHEL/Rocky/Alma 8', kind: 'rpm', arches: ['x86_64', 'aarch64'] },
] as const

type OsOption = (typeof OS_OPTIONS)[number]

type Report = Extract<GitLabBundlerResponse, { ok: true }> & {
  downloaded: Record<string, boolean>
}

async function postJson<T>(body: unknown): Promise<T> {
  const res = await fetch('/api/tools/gitlab-bundler', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as T
}

async function fetchWithProgress(
  step: GitLabBundleStep,
  report: Report,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  const qs = new URLSearchParams({
    edition: report.edition,
    packageTarget: report.packageTarget.key,
    arch: report.packageTarget.arch,
    version: step.version,
  })
  const res = await fetch(`/api/tools/gitlab-bundler?${qs.toString()}`, { cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)

  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? parseInt(totalHeader, 10) : null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, total)
  }

  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function humanBytes(bytes: number | null): string {
  if (bytes == null) return 'Unknown'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function safeVersion(value: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(value)
}

export function GitLabBundler() {
  const [currentVersion, setCurrentVersion] = useState('')
  const [targetVersion, setTargetVersion] = useState('')
  const [edition, setEdition] = useState<'ee' | 'ce'>('ee')
  const [packageTarget, setPackageTarget] = useState<OsOption['value']>('ubuntu-jammy')
  const selectedOs = OS_OPTIONS.find((option) => option.value === packageTarget) ?? OS_OPTIONS[1]!
  const [arch, setArch] = useState<string>(selectedOs.arches[0])
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [currentLoaded, setCurrentLoaded] = useState(0)
  const [currentTotal, setCurrentTotal] = useState<number | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const [downloadTotal, setDownloadTotal] = useState(0)

  const availableSteps = useMemo(
    () => report?.steps.filter((step) => step.status === 'available' && step.filename) ?? [],
    [report],
  )

  const downloadPct = useMemo(() => {
    if (!downloading || downloadTotal === 0) return 0
    const perFile = currentTotal && currentTotal > 0 ? currentLoaded / currentTotal : 0
    return Math.min(100, ((doneCount + perFile) / downloadTotal) * 100)
  }, [currentLoaded, currentTotal, doneCount, downloadTotal, downloading])

  function onOsChange(next: string) {
    const option = OS_OPTIONS.find((entry) => entry.value === next)
    if (!option) return
    setPackageTarget(option.value)
    setArch(option.arches[0])
  }

  async function resolve() {
    setResolveError(null)
    setDownloadError(null)
    setReport(null)
    if (!safeVersion(currentVersion.trim())) {
      setResolveError('Enter a valid current GitLab version, e.g. 16.11.10')
      return
    }
    if (!safeVersion(targetVersion.trim())) {
      setResolveError('Enter a valid target GitLab version, e.g. 18.6.6')
      return
    }

    setResolving(true)
    try {
      const data = await postJson<GitLabBundlerResponse>({
        action: 'resolve',
        currentVersion: currentVersion.trim(),
        targetVersion: targetVersion.trim(),
        edition,
        packageTarget,
        arch,
      })
      if (!data.ok) {
        setResolveError(data.error)
        return
      }
      setReport({ ...data, downloaded: {} })
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Failed to resolve GitLab upgrade path')
    } finally {
      setResolving(false)
    }
  }

  async function downloadSteps(steps: GitLabBundleStep[], label: string) {
    if (!report || steps.length === 0) return
    setDownloadError(null)
    setDownloading(true)
    setDoneCount(0)
    setDownloadTotal(steps.length)
    setCurrentFile(null)
    setCurrentLoaded(0)
    setCurrentTotal(null)

    try {
      const zip = new JSZip()
      const packages = zip.folder('packages')!
      const downloaded: Record<string, boolean> = { ...report.downloaded }

      for (const step of steps) {
        if (!step.filename) continue
        setCurrentFile(step.filename)
        setCurrentLoaded(0)
        setCurrentTotal(step.sizeBytes)
        const bytes = await fetchWithProgress(step, report, (loaded, total) => {
          setCurrentLoaded(loaded)
          setCurrentTotal(total ?? step.sizeBytes)
        })
        packages.file(step.filename, bytes)
        downloaded[step.id] = true
        setReport({ ...report, downloaded })
        setDoneCount((count) => count + 1)
      }

      zip.file(
        'bundle-manifest.json',
        JSON.stringify(
          {
            generatedAt: report.generatedAt,
            currentVersion: report.currentVersion,
            targetVersion: report.targetVersion,
            edition: report.edition,
            packageTarget: report.packageTarget,
            sources: report.sources,
            steps: report.steps,
            included: steps.map((step) => step.id),
          },
          null,
          2,
        ),
      )
      zip.file(
        'README.txt',
        [
          'GitLab air-gap package bundle',
          '',
          `Current version: ${report.currentVersion}`,
          `Target version: ${report.targetVersion}`,
          `Edition: GitLab ${report.edition.toUpperCase()}`,
          `Package target: ${report.packageTarget.label} ${report.packageTarget.arch}`,
          '',
          'Install each package in ascending version order and allow GitLab background migrations to finish between required stops.',
          'Review GitLab upgrade notes before applying packages.',
        ].join('\n'),
      )

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gitlab-${report.edition}-${report.currentVersion}-to-${report.targetVersion}-${label}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
      setCurrentFile(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4" /> GitLab packages
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="gitlab-current">Current GitLab version</Label>
                <Input
                  id="gitlab-current"
                  placeholder="e.g. 16.11.10"
                  value={currentVersion}
                  onChange={(event) => setCurrentVersion(event.target.value)}
                  disabled={resolving || downloading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gitlab-target">Target GitLab version</Label>
                <Input
                  id="gitlab-target"
                  placeholder="e.g. 18.6.6"
                  value={targetVersion}
                  onChange={(event) => setTargetVersion(event.target.value)}
                  disabled={resolving || downloading}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Edition</Label>
                <Select value={edition} onValueChange={(value) => setEdition(value as 'ee' | 'ce')} disabled={resolving || downloading}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ee">Enterprise Edition (EE)</SelectItem>
                    <SelectItem value="ce">Community Edition (CE)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>OS package target</Label>
                <Select value={packageTarget} onValueChange={onOsChange} disabled={resolving || downloading}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Architecture</Label>
                <Select value={arch} onValueChange={setArch} disabled={resolving || downloading}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedOs.arches.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={resolve} disabled={resolving || downloading}>
                {resolving ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Find upgrade packages
              </Button>
              <Button
                variant="outline"
                onClick={() => downloadSteps(availableSteps, 'all')}
                disabled={!report || availableSteps.length === 0 || downloading || resolving}
              >
                {downloading ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
                Download all
              </Button>
            </div>

            {resolveError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>Unable to resolve GitLab packages</AlertTitle>
                <AlertDescription>{resolveError}</AlertDescription>
              </Alert>
            )}
            {downloadError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>Download failed</AlertTitle>
                <AlertDescription>{downloadError}</AlertDescription>
              </Alert>
            )}
            {downloading && (
              <Alert>
                <Loader2 className="size-4 animate-spin" />
                <AlertTitle>Building zip</AlertTitle>
                <AlertDescription>
                  {currentFile ? `${currentFile} (${downloadPct.toFixed(0)}%)` : 'Preparing download...'}{' '}
                  {currentTotal ? `${humanBytes(currentLoaded)} of ${humanBytes(currentTotal)}` : humanBytes(currentLoaded)}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {report && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>Resolved upgrade sequence</span>
                <Badge variant="secondary">{report.steps.length} package{report.steps.length === 1 ? '' : 's'}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.steps.map((step, index) => (
                    <TableRow key={step.id}>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{index + 1}</span>
                          <Badge variant={step.role === 'target' ? 'default' : 'secondary'} className="w-fit">
                            {step.role === 'target' ? 'Target' : 'Required stop'}
                          </Badge>
                          {step.conditional && (
                            <Badge variant="outline" className="w-fit">
                              Conditional
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="font-medium">{step.version}</div>
                        {step.sourceVersion !== step.version && (
                          <div className="text-xs text-muted-foreground">Latest {step.majorMinor} patch</div>
                        )}
                        {step.note && <div className="mt-1 max-w-xl text-xs text-muted-foreground">{step.note}</div>}
                      </TableCell>
                      <TableCell className="align-top">
                        {step.filename ? (
                          <span className="font-mono text-xs">{step.filename}</span>
                        ) : (
                          <span className="text-sm text-destructive">{step.reason}</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">{step.sizeLabel ?? humanBytes(step.sizeBytes)}</TableCell>
                      <TableCell className="align-top text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => downloadSteps([step], step.version)}
                          disabled={downloading || resolving || step.status !== 'available'}
                        >
                          {report.downloaded[step.id] ? <CheckCircle2 className="size-4" /> : <Download className="size-4" />}
                          <span className="sr-only">Download {step.version}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Resolution details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            The resolver reads GitLab&apos;s current upgrade-path document, applies required stops between the current and target
            versions, then searches the selected package repository for the latest available patch package in each required minor.
          </p>
          <p>
            For GitLab 17.5 and later, GitLab documents required stops at x.2, x.5, x.8, and x.11. Conditional stops from older
            release lines are shown with a badge.
          </p>
          {report && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="font-medium text-foreground">{report.packageTarget.label}</div>
              <div>{report.edition.toUpperCase()} / {report.packageTarget.arch} / {report.packageTarget.kind.toUpperCase()}</div>
              <div className="mt-2 break-all text-xs">{report.sources.packages}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
