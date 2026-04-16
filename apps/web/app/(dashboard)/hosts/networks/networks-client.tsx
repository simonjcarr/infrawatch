'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { formatDistanceToNow } from 'date-fns'
import { Plus, Pencil, Trash2, Loader2, Network, Server } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  listNetworks,
  createNetwork,
  updateNetwork,
  deleteNetwork,
} from '@/lib/actions/networks'
import type { NetworkWithCount } from '@/lib/actions/networks'

const networkSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  cidr: z
    .string()
    .regex(
      /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
      'Must be a valid CIDR (e.g. 192.168.1.0/24)',
    ),
  description: z.string().max(500).optional(),
})
type NetworkFormValues = z.infer<typeof networkSchema>

interface Props {
  orgId: string
  initialNetworks: NetworkWithCount[]
}

function NetworkForm({
  defaultValues,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: {
  defaultValues: NetworkFormValues
  onSubmit: (data: NetworkFormValues) => void
  onCancel: () => void
  isPending: boolean
  submitLabel: string
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NetworkFormValues>({
    resolver: zodResolver(networkSchema),
    defaultValues,
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. Office LAN" {...register('name')} />
        {errors.name && (
          <p className="text-destructive text-sm">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cidr">CIDR</Label>
        <Input id="cidr" placeholder="e.g. 192.168.1.0/24" {...register('cidr')} />
        {errors.cidr && (
          <p className="text-destructive text-sm">{errors.cidr.message}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">
          Description{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <textarea
          id="description"
          rows={3}
          placeholder="What is this network used for?"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          {...register('description')}
        />
        {errors.description && (
          <p className="text-destructive text-sm">{errors.description.message}</p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 mr-1 animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function NetworksClient({ orgId, initialNetworks }: Props) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editNetwork, setEditNetwork] = useState<NetworkWithCount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NetworkWithCount | null>(null)

  const { data: networkList = initialNetworks } = useQuery({
    queryKey: ['networks', orgId],
    queryFn: () => listNetworks(orgId),
    initialData: initialNetworks,
  })

  const { mutate: doCreate, isPending: isCreating } = useMutation({
    mutationFn: (data: NetworkFormValues) =>
      createNetwork(orgId, {
        name: data.name,
        cidr: data.cidr,
        description: data.description || undefined,
      }),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
      setCreateOpen(false)
    },
  })

  const { mutate: doUpdate, isPending: isUpdating } = useMutation({
    mutationFn: (data: NetworkFormValues) =>
      updateNetwork(orgId, editNetwork!.id, {
        name: data.name,
        cidr: data.cidr,
        description: data.description || undefined,
      }),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
      setEditNetwork(null)
    },
  })

  const { mutate: doDelete, isPending: isDeleting } = useMutation({
    mutationFn: (networkId: string) => deleteNetwork(orgId, networkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks', orgId] })
      setDeleteTarget(null)
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Networks</h1>
            <p className="text-sm text-muted-foreground">
              Define IP subnets and automatically group hosts by network
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1" />
          New Network
        </Button>
      </div>

      {/* Table */}
      {networkList.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Network className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No networks yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a network to automatically group hosts by their IP subnet.
          </p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" />
            New Network
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>CIDR</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Hosts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {networkList.map((network) => (
                <TableRow key={network.id}>
                  <TableCell>
                    <Link
                      href={`/hosts/networks/${network.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {network.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {network.cidr}
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {network.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Server className="size-3.5" />
                      {network.hostCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(network.createdAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditNetwork(network)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(network)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Network</DialogTitle>
          </DialogHeader>
          <NetworkForm
            defaultValues={{ name: '', cidr: '', description: '' }}
            onSubmit={(d) => doCreate(d)}
            onCancel={() => setCreateOpen(false)}
            isPending={isCreating}
            submitLabel="Create Network"
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editNetwork}
        onOpenChange={(open) => {
          if (!open) setEditNetwork(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Network</DialogTitle>
          </DialogHeader>
          {editNetwork && (
            <NetworkForm
              defaultValues={{
                name: editNetwork.name,
                cidr: editNetwork.cidr,
                description: editNetwork.description ?? '',
              }}
              onSubmit={(d) => doUpdate(d)}
              onCancel={() => setEditNetwork(null)}
              isPending={isUpdating}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the network and all its host memberships. Hosts themselves will not
              be affected. Auto-assigned hosts will be re-added on their next heartbeat if their IP
              still falls within the CIDR.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && doDelete(deleteTarget.id)}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="size-4 mr-1 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
