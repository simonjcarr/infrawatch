'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Box, Search, X, ShieldAlert, WifiOff, AlertTriangle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getHostDockerContainers } from '@/lib/actions/docker-containers'
import type { DockerRuntimeStatus, HostDockerStatus } from '@/lib/db/schema/docker'

interface Props {
  scopeId: string
  hostId: string
  dockerStatus?: HostDockerStatus | null
}

type DisplayStatus = DockerRuntimeStatus | 'unknown'

const stateOptions = [
  { value: 'all', label: 'All states' },
  { value: 'running', label: 'Running' },
  { value: 'exited', label: 'Exited' },
  { value: 'created', label: 'Created' },
  { value: 'paused', label: 'Paused' },
  { value: 'restarting', label: 'Restarting' },
  { value: 'removing', label: 'Removing' },
  { value: 'dead', label: 'Dead' },
]

const unavailableCopy: Record<Exclude<DisplayStatus, 'installed'>, { title: string; body: string; icon: typeof AlertTriangle }> = {
  unknown: {
    title: 'Docker status unknown',
    body: 'No Docker runtime status has been reported for this host yet.',
    icon: AlertTriangle,
  },
  not_installed: {
    title: 'Docker not installed',
    body: 'Docker Engine is not installed or was not found on this host.',
    icon: WifiOff,
  },
  permission_denied: {
    title: 'Permission denied',
    body: 'The agent found Docker but cannot read container inventory.',
    icon: ShieldAlert,
  },
  unreachable: {
    title: 'Docker unreachable',
    body: 'Docker was detected but did not respond to the agent.',
    icon: AlertTriangle,
  },
  error: {
    title: 'Docker status error',
    body: 'The agent hit an unexpected Docker status check error.',
    icon: AlertTriangle,
  },
}

function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return '-'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function formatAbsolute(date: Date | string | null | undefined): string {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

function ContainerStateBadge({ state, present }: { state: string | null; present: boolean }) {
  if (!present) {
    return (
      <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
        Not present
      </Badge>
    )
  }
  if (state === 'running') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        Running
      </Badge>
    )
  }
  if (state === 'exited' || state === 'dead') {
    return (
      <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
        {state === 'dead' ? 'Dead' : 'Exited'}
      </Badge>
    )
  }
  if (state === 'restarting' || state === 'paused') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
        {state === 'restarting' ? 'Restarting' : 'Paused'}
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100">
      {state || 'Unknown'}
    </Badge>
  )
}

function EmptyState({ title, body, icon: Icon = Box }: { title: string; body: string; icon?: typeof Box }) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <Icon className="size-8 mx-auto text-muted-foreground mb-3" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{body}</p>
    </div>
  )
}

export function ContainersTab({ scopeId, hostId, dockerStatus }: Props) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [image, setImage] = useState('all')
  const status: DisplayStatus = dockerStatus?.status ?? 'unknown'
  const dockerUnavailable = status !== 'installed'

  const { data, isLoading } = useQuery({
    queryKey: ['host-docker-containers', scopeId, hostId, search, state, image],
    queryFn: () => getHostDockerContainers(scopeId, hostId, { search, state, image }),
    enabled: !dockerUnavailable,
  })

  const containers = data?.containers ?? []
  const imageOptions = data?.imageOptions ?? []
  const hasActiveFilters = search.trim() !== '' || state !== 'all' || image !== 'all'
  const clearFilters = () => {
    setSearch('')
    setState('all')
    setImage('all')
  }

  if (dockerUnavailable) {
    const copy = unavailableCopy[status]
    return (
      <div data-testid="host-containers-tab">
        <EmptyState title={copy.title} body={copy.body} icon={copy.icon} />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="host-containers-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading containers...' : `${containers.length} container${containers.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, image or ID"
              className="pl-8"
              data-testid="host-containers-search"
            />
          </div>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="w-36" data-testid="host-containers-state-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stateOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={image} onValueChange={setImage}>
            <SelectTrigger className="w-48" data-testid="host-containers-image-filter">
              <SelectValue placeholder="Image" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All images</SelectItem>
              {imageOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Box className="size-4 text-muted-foreground" />
            Container Inventory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="size-5 mx-auto mb-2 animate-spin" />
              Loading containers...
            </div>
          ) : containers.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState title="No containers match your filters" body="Clear the current filters to see all known Docker containers for this host." />
            ) : (
              <EmptyState title="No containers reported" body="Docker is installed, but no current or recently seen containers have been reported yet." />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Restarts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((container) => (
                  <TableRow
                    key={container.id}
                    data-testid={`host-docker-container-row-${container.dockerContainerId}`}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {container.primaryName || container.namesJson[0] || container.dockerContainerId.slice(0, 12)}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {container.dockerContainerId.slice(0, 12)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm">
                      {container.image || '-'}
                    </TableCell>
                    <TableCell>
                      <ContainerStateBadge state={container.state} present={container.isPresent} />
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                      {container.status || '-'}
                    </TableCell>
                    <TableCell className="text-sm">{formatRelative(container.lastSeenAt)}</TableCell>
                    <TableCell className="text-sm">{formatAbsolute(container.startedAtSource)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {container.restartCount ?? '-'}
                    </TableCell>
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
