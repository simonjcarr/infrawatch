'use client'

import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle, Clock, Package, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getHostPatchStatus } from '@/lib/actions/patch-status'

interface Props {
  orgId: string
  hostId: string
}

function PatchBadge({ status }: { status: string }) {
  if (status === 'pass') {
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Within policy</Badge>
  }
  if (status === 'fail') {
    return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Outside policy</Badge>
  }
  if (status === 'error') {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Check error</Badge>
  }
  return <Badge variant="outline">Unknown</Badge>
}

export function PatchStatusTab({ orgId, hostId }: Props) {
  const { data: patchStatus, isLoading } = useQuery({
    queryKey: ['host-patch-status', orgId, hostId],
    queryFn: () => getHostPatchStatus(orgId, hostId),
  })

  if (isLoading) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <Clock className="size-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Loading patch status…</p>
      </div>
    )
  }

  if (!patchStatus) {
    return (
      <div data-testid="host-patch-status-tab" className="rounded-lg border border-dashed p-12 text-center">
        <ShieldAlert className="size-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">No patch status yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add a Patch Status check to start tracking this host.
        </p>
      </div>
    )
  }

  const updatesLabel = `${patchStatus.updatesCount} ${patchStatus.updatesCount === 1 ? 'update' : 'updates'} available`

  return (
    <div data-testid="host-patch-status-tab" className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Patch Status</p>
            <div className="flex items-center gap-2">
              {patchStatus.status === 'pass' ? (
                <CheckCircle className="size-5 text-green-600" />
              ) : (
                <AlertTriangle className="size-5 text-red-600" />
              )}
              <PatchBadge status={patchStatus.status} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Patch Age</p>
            <p className="text-3xl font-bold tabular-nums">
              {patchStatus.patchAgeDays == null ? '—' : `${patchStatus.patchAgeDays} days`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Policy</p>
            <p className="text-3xl font-bold tabular-nums">{patchStatus.maxAgeDays} days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Available Updates</p>
            <p className="text-3xl font-bold tabular-nums">{patchStatus.updatesCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Patch Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Last patched</dt>
              <dd className="font-medium text-right">
                {patchStatus.lastPatchedAt
                  ? formatDistanceToNow(new Date(patchStatus.lastPatchedAt), { addSuffix: true })
                  : 'Unknown'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="font-medium text-right">
                {formatDistanceToNow(new Date(patchStatus.checkedAt), { addSuffix: true })}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Package manager</dt>
              <dd className="font-medium text-right">{patchStatus.packageManager ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Update listing</dt>
              <dd className="font-medium text-right">
                {patchStatus.updatesSupported ? updatesLabel : 'Not supported'}
              </dd>
            </div>
          </dl>
          {patchStatus.error && (
            <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {patchStatus.error}
            </p>
          )}
          {patchStatus.warnings.length > 0 && (
            <div className="mt-4 space-y-1">
              {patchStatus.warnings.map((warning) => (
                <p key={warning} className="text-xs text-muted-foreground">{warning}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            Current Available Updates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!patchStatus.updatesSupported ? (
            <p className="text-sm text-muted-foreground">Package update listing is not supported for this operating system.</p>
          ) : patchStatus.updates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No current package updates reported.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Architecture</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patchStatus.updates.map((update) => (
                  <TableRow key={update.id}>
                    <TableCell className="font-medium">{update.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{update.currentVersion ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{update.availableVersion ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{update.architecture ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
