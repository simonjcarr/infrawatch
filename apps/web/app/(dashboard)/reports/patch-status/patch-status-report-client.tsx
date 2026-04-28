'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle, Network, Package, ShieldAlert } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
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
import type { PatchManagementReport } from '@/lib/actions/patch-status'

interface Props {
  report: PatchManagementReport
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'pass') return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Within policy</Badge>
  if (status === 'fail') return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Outside policy</Badge>
  if (status === 'error') return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Check error</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

function age(value: number | null) {
  return value == null ? '—' : `${value}d`
}

export function PatchStatusReportClient({ report }: Props) {
  const compliantPercent = report.summary.totalHosts === 0
    ? 0
    : Math.round((report.summary.passingCount / report.summary.totalHosts) * 100)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Patch Status</h1>
          <p className="text-sm text-muted-foreground">
            Estate and network patch compliance generated {formatDistanceToNow(new Date(report.generatedAt), { addSuffix: true })}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Compliance</p>
            <p className="text-4xl font-bold tabular-nums">{compliantPercent}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Hosts</p>
            <p className="text-4xl font-bold tabular-nums">{report.summary.totalHosts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Outside Policy</p>
            <p className="text-4xl font-bold tabular-nums text-red-600">{report.summary.failingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Oldest Patch Age</p>
            <p className="text-4xl font-bold tabular-nums">{age(report.summary.oldestPatchAgeDays)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Available Updates</p>
            <p className="text-4xl font-bold tabular-nums">{report.summary.totalAvailableUpdates}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            Network Patch Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.networks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No host networks have been assigned yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Network</TableHead>
                  <TableHead className="text-right">Hosts</TableHead>
                  <TableHead className="text-right">Within Policy</TableHead>
                  <TableHead className="text-right">Outside Policy</TableHead>
                  <TableHead className="text-right">Oldest Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.networks.map((network) => (
                  <TableRow key={network.networkId}>
                    <TableCell>
                      <Link href={`/hosts/networks/${network.networkId}`} className="font-medium hover:underline">
                        {network.networkName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{network.hostCount}</TableCell>
                    <TableCell className="text-right text-green-700">{network.passingCount}</TableCell>
                    <TableCell className="text-right text-red-700">{network.failingCount}</TableCell>
                    <TableCell className="text-right">{age(network.oldestPatchAgeDays)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="size-4 text-muted-foreground" />
            Host Patch Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.hosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hosts registered.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Networks</TableHead>
                  <TableHead className="text-right">Patch Age</TableHead>
                  <TableHead className="text-right">Policy</TableHead>
                  <TableHead className="text-right">Updates</TableHead>
                  <TableHead>OS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.hosts.map((host) => (
                  <TableRow key={host.hostId}>
                    <TableCell>
                      <Link href={`/hosts/${host.hostId}`} className="font-medium hover:underline">
                        {host.displayName ?? host.hostname}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {host.status === 'pass' ? (
                          <CheckCircle className="size-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="size-4 text-red-600" />
                        )}
                        <StatusBadge status={host.status} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {host.networkNames.length > 0 ? host.networkNames.join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{age(host.patchAgeDays)}</TableCell>
                    <TableCell className="text-right tabular-nums">{host.maxAgeDays}d</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <Package className="size-3.5 text-muted-foreground" />
                        {host.updatesCount}
                      </span>
                    </TableCell>
                    <TableCell>{host.os ?? host.osVersion ?? '—'}</TableCell>
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
