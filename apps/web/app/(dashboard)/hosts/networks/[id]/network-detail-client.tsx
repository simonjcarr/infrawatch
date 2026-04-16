'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Server,
  CheckCircle,
  WifiOff,
  AlertTriangle,
  Search,
  Network,
  Zap,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getNetwork,
  addHostToNetwork,
  removeHostFromNetwork,
  listMembershipsForNetwork,
} from '@/lib/actions/networks'
import { listHosts } from '@/lib/actions/agents'
import type { HostWithAgent } from '@/lib/actions/agents'
import type { Network as NetworkType, Host } from '@/lib/db/schema'

type NetworkWithMembers = NetworkType & { members: Host[] }

interface Props {
  orgId: string
  initialNetwork: NetworkWithMembers
  initialAllHosts: HostWithAgent[]
}

function HostStatusIcon({ status }: { status: string }) {
  if (status === 'online') return <CheckCircle className="size-3.5 text-green-500" />
  if (status === 'offline') return <WifiOff className="size-3.5 text-red-500" />
  return <AlertTriangle className="size-3.5 text-yellow-500" />
}

export function NetworkDetailClient({ orgId, initialNetwork, initialAllHosts }: Props) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null)

  const { data: network = initialNetwork } = useQuery({
    queryKey: ['network', orgId, initialNetwork.id],
    queryFn: () => getNetwork(orgId, initialNetwork.id),
    initialData: initialNetwork,
    select: (d) => d ?? initialNetwork,
  })

  const { data: memberships = [] } = useQuery({
    queryKey: ['network-memberships', orgId, initialNetwork.id],
    queryFn: () => listMembershipsForNetwork(orgId, initialNetwork.id),
  })

  const { data: allHosts = initialAllHosts } = useQuery({
    queryKey: ['hosts', orgId],
    queryFn: () => listHosts(orgId),
    initialData: initialAllHosts,
    enabled: addOpen,
  })

  const memberIds = new Set(network.members.map((m) => m.id))
  const autoAssignedMap = new Map(memberships.map((m) => [m.hostId, m.autoAssigned]))

  const availableHosts = allHosts.filter(
    (h) =>
      !memberIds.has(h.id) &&
      (h.hostname ?? h.displayName ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const { mutate: doAdd, isPending: isAdding } = useMutation({
    mutationFn: (hostId: string) => addHostToNetwork(orgId, network.id, hostId),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['network', orgId, network.id] })
      queryClient.invalidateQueries({ queryKey: ['network-memberships', orgId, network.id] })
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
      setAddOpen(false)
      setSearch('')
    },
  })

  const { mutate: doRemove, isPending: isRemoving } = useMutation({
    mutationFn: (hostId: string) => removeHostFromNetwork(orgId, network.id, hostId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['network', orgId, network.id] })
      queryClient.invalidateQueries({ queryKey: ['network-memberships', orgId, network.id] })
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
      setRemoveTarget(null)
    },
  })

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Back link */}
        <Link
          href="/hosts/networks"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All Networks
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Network className="size-6 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{network.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm bg-muted px-2 py-0.5 rounded font-mono">{network.cidr}</code>
                {network.description && (
                  <span className="text-sm text-muted-foreground">{network.description}</span>
                )}
              </div>
            </div>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-1" />
            Add Host
          </Button>
        </div>

        {/* Members table */}
        {network.members.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <Server className="size-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">No hosts in this network</p>
            <p className="text-xs text-muted-foreground mt-1">
              Hosts are added automatically when their IP falls within{' '}
              <code className="font-mono">{network.cidr}</code>, or you can add them manually.
            </p>
            <Button className="mt-4" onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-1" />
              Add Host
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>IP Addresses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {network.members.map((host) => {
                  const isAuto = autoAssignedMap.get(host.id) ?? false
                  return (
                    <TableRow key={host.id}>
                      <TableCell>
                        <Link
                          href={`/hosts/${host.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {host.displayName ?? host.hostname ?? host.id}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(host.ipAddresses as string[] | null)?.join(', ') ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <HostStatusIcon status={host.status ?? 'unknown'} />
                          <span className="capitalize text-muted-foreground">
                            {host.status ?? 'unknown'}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {isAuto ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="gap-1 text-xs cursor-default">
                                <Zap className="size-3" />
                                Auto
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs text-xs">
                                Auto-assigned based on IP match. Will be re-added on the next
                                heartbeat if the IP still falls within the CIDR.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <User className="size-3" />
                            Manual
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(host.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setRemoveTarget(host)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add Host Dialog */}
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            if (!open) {
              setAddOpen(false)
              setSearch('')
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Host to Network</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search hosts…"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
                {availableHosts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {search
                      ? 'No hosts match your search'
                      : 'All hosts are already in this network'}
                  </p>
                ) : (
                  availableHosts.map((host) => (
                    <button
                      key={host.id}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => doAdd(host.id)}
                      disabled={isAdding}
                    >
                      <span className="flex items-center gap-2">
                        <HostStatusIcon status={host.status ?? 'unknown'} />
                        <span className="text-sm font-medium">
                          {host.displayName ?? host.hostname ?? host.id}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {(host.ipAddresses as string[] | null)?.[0] ?? ''}
                        </span>
                      </span>
                      {isAdding && (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Remove Confirm */}
        <AlertDialog
          open={!!removeTarget}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove &quot;{removeTarget?.displayName ?? removeTarget?.hostname}&quot;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This host will be removed from the network. If it was auto-assigned (its IP falls
                within <code className="font-mono">{network.cidr}</code>), it will be re-added
                automatically on the next heartbeat.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => removeTarget && doRemove(removeTarget.id)}
                disabled={isRemoving}
              >
                {isRemoving && <Loader2 className="size-4 mr-1 animate-spin" />}
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}
