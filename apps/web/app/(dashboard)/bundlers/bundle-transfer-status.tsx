'use client'

import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TransferJobStatus } from './bundle-transfer-dialog'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return 'Unknown'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function filePct(job: TransferJobStatus): number {
  if (!job.currentTotal || job.currentTotal <= 0) return 0
  return Math.min(100, (job.currentLoaded / job.currentTotal) * 100)
}

function overallPct(job: TransferJobStatus): number {
  if (job.filesTotal <= 0) return 0
  const current = job.currentTotal && job.currentTotal > 0 ? job.currentLoaded / job.currentTotal : 0
  return Math.min(100, ((job.filesDone + current) / job.filesTotal) * 100)
}

export function BundleTransferStatus({
  job,
  onJobChange,
}: {
  job: TransferJobStatus | null
  onJobChange: (job: TransferJobStatus) => void
}) {
  useEffect(() => {
    if (!job || job.phase === 'completed' || job.phase === 'failed') return

    const timer = window.setInterval(async () => {
      const res = await fetch(`/api/tools/bundle-transfer?jobId=${encodeURIComponent(job.id)}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; job?: TransferJobStatus } | null
      if (res.ok && data?.ok && data.job) onJobChange(data.job)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [job, onJobChange])

  if (!job) return null

  if (job.phase === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Transfer failed</AlertTitle>
        <AlertDescription>{job.error ?? 'The bundle could not be transferred.'}</AlertDescription>
      </Alert>
    )
  }

  if (job.phase === 'completed') {
    return (
      <Alert>
        <CheckCircle2 className="size-4" />
        <AlertTitle>Transfer complete</AlertTitle>
        <AlertDescription>
          Bundle written to <span className="font-medium">{job.host}</span>
          <span className="block break-all font-mono text-xs">{job.path}</span>
        </AlertDescription>
      </Alert>
    )
  }

  const downloading = job.phase === 'queued' || job.phase === 'downloading'
  const transferring = job.phase === 'transferring'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4" />
          Bundle transfer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4 text-emerald-600" />}
              Download bundle files
            </span>
            <span className="text-xs text-muted-foreground">
              {job.filesDone} / {job.filesTotal || '...'}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${overallPct(job)}%` }} />
          </div>
          {downloading && (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">{job.currentFile ?? 'Preparing downloads...'}</span>
              <span className="shrink-0">
                {job.currentTotal ? `${formatBytes(job.currentLoaded)} / ${formatBytes(job.currentTotal)}` : formatBytes(job.currentLoaded)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              {transferring ? <Loader2 className="size-4 animate-spin" /> : <span className="size-4 rounded-full border" />}
              Transfer to host
            </span>
            <span className="max-w-[50%] truncate text-xs text-muted-foreground">{job.host}</span>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="break-all font-mono">{job.path}</div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-emerald-600 transition-[width] duration-150"
                style={{ width: transferring ? `${Math.max(12, filePct(job))}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
