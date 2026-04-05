'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle, Clock, WifiOff, XCircle, Server, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  listHosts,
  listPendingAgents,
  approveAgent,
  rejectAgent,
} from '@/lib/actions/agents'
import type { HostWithAgent } from '@/lib/actions/agents'
import type { Agent } from '@/lib/db/schema'

interface HostsClientProps {
  orgId: string
  currentUserId: string
  currentUserRole: string
  initialHosts: HostWithAgent[]
  initialPendingAgents: Agent[]
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'online':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          <CheckCircle className="size-3 mr-1" />
          Online
        </Badge>
      )
    case 'offline':
      return (
        <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
          <WifiOff className="size-3 mr-1" />
          Offline
        </Badge>
      )
    case 'pending':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          <Clock className="size-3 mr-1" />
          Pending
        </Badge>
      )
    case 'revoked':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          <XCircle className="size-3 mr-1" />
          Revoked
        </Badge>
      )
    default:
      return (
        <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
          <AlertTriangle className="size-3 mr-1" />
          Unknown
        </Badge>
      )
  }
}

function formatHeartbeat(date: Date | string | null): string {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1)}%`
}

export function HostsClient({
  orgId,
  currentUserId,
  currentUserRole,
  initialHosts,
  initialPendingAgents,
}: HostsClientProps) {
  const queryClient = useQueryClient()
  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'org_admin'

  const { data: hostsData } = useQuery({
    queryKey: ['hosts', orgId],
    queryFn: () => listHosts(orgId),
    initialData: initialHosts,
    refetchInterval: 30_000,
  })

  const { data: pendingAgents } = useQuery({
    queryKey: ['agents', 'pending', orgId],
    queryFn: () => listPendingAgents(orgId),
    initialData: initialPendingAgents,
    refetchInterval: 15_000,
  })

  const approveMutation = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      approveAgent(orgId, agentId, currentUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', 'pending', orgId] })
      queryClient.invalidateQueries({ queryKey: ['hosts', orgId] })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      rejectAgent(orgId, agentId, currentUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', 'pending', orgId] })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Hosts</h1>
        <p className="text-muted-foreground mt-1">
          {hostsData.length} host{hostsData.length !== 1 ? 's' : ''} registered
        </p>
      </div>

      {isAdmin && pendingAgents.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-amber-900 flex items-center gap-2">
              <Clock className="size-4" />
              Pending Agent Approval ({pendingAgents.length})
            </CardTitle>
            <CardDescription className="text-amber-700">
              These agents are waiting for approval before they can send data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-amber-900">Hostname</TableHead>
                  <TableHead className="text-amber-900">OS</TableHead>
                  <TableHead className="text-amber-900">Registered</TableHead>
                  <TableHead className="text-amber-900">Public Key</TableHead>
                  <TableHead className="text-amber-900 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingAgents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium text-amber-900">{agent.hostname}</TableCell>
                    <TableCell className="text-amber-800">
                      {agent.os ?? '—'} {agent.arch ? `(${agent.arch})` : ''}
                    </TableCell>
                    <TableCell className="text-amber-800">
                      {formatHeartbeat(agent.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-amber-800 max-w-xs truncate">
                      {agent.publicKey.slice(0, 40)}…
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => approveMutation.mutate({ agentId: agent.id })}
                          disabled={approveMutation.isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                          onClick={() => rejectMutation.mutate({ agentId: agent.id })}
                          disabled={rejectMutation.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            Host Inventory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hostsData.length === 0 ? (
            <div className="text-center py-12">
              <Server className="size-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No hosts registered yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Deploy an agent to start monitoring your infrastructure.
              </p>
              {isAdmin && (
                <p className="text-sm text-muted-foreground mt-2">
                  Create an enrolment token in{' '}
                  <a href="/settings/agents" className="text-primary underline underline-offset-2">
                    Settings → Agents
                  </a>{' '}
                  to get started.
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hostname</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>IP Addresses</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hostsData.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/hosts/${host.id}`}
                        className="hover:underline text-foreground"
                      >
                        {host.displayName ?? host.hostname}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {host.os ?? '—'}
                      {host.arch && (
                        <span className="text-muted-foreground/60"> ({host.arch})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(host.ipAddresses ?? []).slice(0, 2).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-sm">{formatPercent(host.cpuPercent)}</TableCell>
                    <TableCell className="text-sm">{formatPercent(host.memoryPercent)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatHeartbeat(host.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={host.status} />
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
