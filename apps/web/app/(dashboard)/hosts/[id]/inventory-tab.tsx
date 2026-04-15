'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { AlertTriangle, Download, GitCompare, RefreshCw, Search, Eye, EyeOff, Loader2, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getHostSoftwareInventory, triggerSoftwareScan } from '@/lib/actions/software-inventory'
import type { SoftwarePackage } from '@/lib/db/schema'

interface Props {
  hostId: string
  orgId: string
}

function staleBannerAge(lastScanAt: string | undefined, intervalHours: number): boolean {
  if (!lastScanAt) return false
  const ms = Date.now() - new Date(lastScanAt).getTime()
  const hoursElapsed = ms / (1000 * 60 * 60)
  return hoursElapsed > intervalHours * 2
}

function formatScanAge(lastScanAt: string | undefined): string {
  if (!lastScanAt) return 'never'
  return formatDistanceToNow(new Date(lastScanAt), { addSuffix: true })
}

function sourceBadge(source: string) {
  const colors: Record<string, string> = {
    rpm: 'bg-red-100 text-red-800 border-red-200',
    dpkg: 'bg-blue-100 text-blue-800 border-blue-200',
    pacman: 'bg-green-100 text-green-800 border-green-200',
    apk: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    winreg: 'bg-purple-100 text-purple-800 border-purple-200',
    homebrew: 'bg-amber-100 text-amber-800 border-amber-200',
    snap: 'bg-orange-100 text-orange-800 border-orange-200',
    flatpak: 'bg-teal-100 text-teal-800 border-teal-200',
    macapps: 'bg-gray-100 text-gray-800 border-gray-200',
  }
  return colors[source] ?? 'bg-gray-100 text-gray-700 border-gray-200'
}

export function InventoryTab({ hostId, orgId }: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['host-software-inventory', hostId, showRemoved],
    queryFn: () => getHostSoftwareInventory(orgId, hostId, showRemoved),
    // Poll every 5 s while a scan is queued or running, stop when it completes.
    refetchInterval: (query) => {
      const activeScan = (query.state.data as Awaited<ReturnType<typeof getHostSoftwareInventory>> | undefined)?.activeScan
      return activeScan ? 5_000 : false
    },
  })

  const triggerMutation = useMutation({
    mutationFn: () => triggerSoftwareScan(orgId, hostId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-software-inventory', hostId] })
    },
  })

  const filtered = useMemo(() => {
    const packages = data?.packages ?? []
    if (!search.trim()) return packages
    const q = search.toLowerCase()
    return packages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.version.toLowerCase().includes(q) ||
        (p.publisher ?? '').toLowerCase().includes(q),
    )
  }, [data?.packages, search])

  const lastScan = data?.lastScan
  const settings = data?.settings
  const lastScanAt = data?.packages[0]?.lastSeenAt?.toString()

  const isStale =
    settings?.enabled && data?.packages.length === 0
      ? false
      : staleBannerAge(
          lastScan?.completedAt?.toISOString() ?? undefined,
          settings?.intervalHours ?? 24,
        )

  function handleExportCsv() {
    window.open(`/api/reports/software/export?format=csv&hostId=${hostId}`, '_blank')
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading inventory…</span>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load software inventory.</AlertDescription>
      </Alert>
    )
  }

  if (!settings?.enabled && !lastScan) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Package className="size-10 text-muted-foreground/50" />
        <div>
          <p className="text-sm font-medium text-foreground">Software inventory is not enabled</p>
          <p className="text-sm text-muted-foreground mt-1">
            Enable software scanning in{' '}
            <a href="/settings" className="underline text-foreground">
              Settings → Organisation
            </a>{' '}
            to start collecting package data.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground space-x-2">
          {lastScan ? (
            <>
              <span>
                Last scan: <span className="text-foreground font-medium">{formatScanAge(lastScan.completedAt?.toISOString())}</span>
              </span>
              <span>•</span>
              <span>
                <span className="text-foreground font-medium">{lastScan.packageCount.toLocaleString()}</span> packages
              </span>
              {lastScan.source && (
                <>
                  <span>•</span>
                  <Badge variant="outline" className={`text-xs ${sourceBadge(lastScan.source)}`}>
                    {lastScan.source}
                  </Badge>
                </>
              )}
              {lastScan.addedCount > 0 && (
                <span className="text-green-700">+{lastScan.addedCount}</span>
              )}
              {lastScan.removedCount > 0 && (
                <span className="text-red-600">−{lastScan.removedCount}</span>
              )}
            </>
          ) : (
            <span>No scan data yet</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
          >
            {triggerMutation.isPending ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            Rescan now
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="size-3.5 mr-1.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/hosts/${hostId}/compare`}>
              <GitCompare className="size-3.5 mr-1.5" />
              Compare
            </Link>
          </Button>
        </div>
      </div>

      {/* Stale scan warning */}
      {isStale && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            This host hasn&apos;t been scanned since{' '}
            {lastScan?.completedAt
              ? format(new Date(lastScan.completedAt), 'PPP')
              : 'the last scan'}
            . Possible reasons: host offline, scanning disabled, or agent outdated.
          </AlertDescription>
        </Alert>
      )}

      {/* Active scan status */}
      {data?.activeScan === 'pending' && (
        <Alert>
          <Loader2 className="size-4 animate-spin" />
          <AlertDescription>
            Scan queued — waiting for the agent to pick it up…
          </AlertDescription>
        </Alert>
      )}
      {data?.activeScan === 'running' && (
        <Alert>
          <Loader2 className="size-4 animate-spin" />
          <AlertDescription>
            Scan in progress — collecting packages…
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter by name, version, publisher…"
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowRemoved((v) => !v)}
          className="text-muted-foreground"
        >
          {showRemoved ? <EyeOff className="size-3.5 mr-1.5" /> : <Eye className="size-3.5 mr-1.5" />}
          {showRemoved ? 'Hide removed' : 'Show removed'}
        </Button>
      </div>

      {/* Package count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length.toLocaleString()} package{filtered.length === 1 ? '' : 's'}
        {search ? ` matching "${search}"` : ''}
      </p>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          {search ? 'No packages match your filter.' : 'No packages found.'}
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Architecture</TableHead>
                <TableHead>Publisher</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>First seen</TableHead>
                <TableHead>Last seen</TableHead>
                {showRemoved && <TableHead>Removed</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((pkg) => (
                <TableRow
                  key={pkg.id}
                  className={pkg.removedAt ? 'opacity-50 line-through' : undefined}
                >
                  <TableCell className="font-mono text-xs">{pkg.name}</TableCell>
                  <TableCell className="font-mono text-xs">{pkg.version}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pkg.architecture ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {pkg.publisher ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${sourceBadge(pkg.source)}`}>
                      {pkg.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(pkg.firstSeenAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(pkg.lastSeenAt), { addSuffix: true })}
                  </TableCell>
                  {showRemoved && (
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {pkg.removedAt
                        ? formatDistanceToNow(new Date(pkg.removedAt), { addSuffix: true })
                        : '—'}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
