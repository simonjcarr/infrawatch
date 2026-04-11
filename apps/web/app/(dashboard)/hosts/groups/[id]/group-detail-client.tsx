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
  Clock,
  Search,
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
  getGroup,
  addHostToGroup,
  removeHostFromGroup,
} from '@/lib/actions/host-groups'
import { listHosts } from '@/lib/actions/agents'
import type { HostGroupWithMembers } from '@/lib/actions/host-groups'
import type { HostWithAgent } from '@/lib/actions/agents'
import type { Host } from '@/lib/db/schema'

interface Props {
  orgId: string
  initialGroup: HostGroupWithMembers
  initialAllHosts: HostWithAgent[]
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
    default:
      return (
        <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
          <AlertTriangle className="size-3 mr-1" />
          Unknown
        </Badge>
      )
  }
}

export function GroupDetailClient({ orgId, initialGroup, initialAllHosts }: Props) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null)

  const { data: group } = useQuery({
    queryKey: ['host-group', orgId, initialGroup.id],
    queryFn: () => getGroup(orgId, initialGroup.id),
    initialData: initialGroup,
    refetchInterval: 30_000,
  })

  const { data: allHosts = initialAllHosts } = useQuery({
    queryKey: ['hosts', orgId],
    queryFn: () => listHosts(orgId),
    initialData: initialAllHosts,
    enabled: addOpen,
  })

  const { mutate: doAdd, isPending: isAdding } = useMutation({
    mutationFn: (hostId: string) => addHostToGroup(orgId, group!.id, hostId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-group', orgId, initialGroup.id] })
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
    },
  })

  const { mutate: doRemove, isPending: isRemoving } = useMutation({
    mutationFn: (hostId: string) => removeHostFromGroup(orgId, group!.id, hostId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-group', orgId, initialGroup.id] })
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
      setRemoveTarget(null)
    },
  })

  if (!group) return null

  const memberIds = new Set(group.members.map((h) => h.id))

  const filteredSearch = allHosts.filter((h) => {
    if (memberIds.has(h.id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      h.hostname.toLowerCase().includes(q) ||
      (h.displayName ?? '').toLowerCase().includes(q) ||
      (h.os ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/hosts/groups"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to groups
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{group.name}</h1>
            {group.description && (
              <p className="text-sm text-muted-foreground mt-1">{group.description}</p>
            )}
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-1" />
            Add Hosts
          </Button>
        </div>
      </div>

      {/* Members table */}
      {group.members.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Server className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No hosts in this group</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add hosts to this group to target them in batch operations.
          </p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-1" />
            Add Hosts
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.members.map((host) => (
                <TableRow key={host.id}>
                  <TableCell>
                    <Link
                      href={`/hosts/${host.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {host.displayName ?? host.hostname}
                    </Link>
                    {host.displayName && (
                      <p className="text-xs text-muted-foreground">{host.hostname}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {host.os ? `${host.os} ${host.osVersion ?? ''}`.trim() : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={host.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {host.lastSeenAt
                      ? formatDistanceToNow(new Date(host.lastSeenAt), { addSuffix: true })
                      : 'Never'}
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Hosts Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Hosts to &quot;{group.name}&quot;</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search hosts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border divide-y">
              {filteredSearch.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {allHosts.length === group.members.length
                    ? 'All hosts are already in this group'
                    : 'No hosts match your search'}
                </p>
              ) : (
                filteredSearch.map((host) => (
                  <div
                    key={host.id}
                    className="flex items-center justify-between px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {host.displayName ?? host.hostname}
                      </p>
                      {host.displayName && (
                        <p className="text-xs text-muted-foreground">{host.hostname}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isAdding}
                      onClick={() => doAdd(host.id)}
                    >
                      {isAdding ? <Loader2 className="size-3.5 animate-spin" /> : 'Add'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove &quot;{removeTarget?.displayName ?? removeTarget?.hostname}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the host from the group. The host itself will not be affected.
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
  )
}
