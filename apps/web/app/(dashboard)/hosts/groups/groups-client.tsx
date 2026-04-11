'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { formatDistanceToNow } from 'date-fns'
import { Plus, Pencil, Trash2, Loader2, Layers, Users } from 'lucide-react'
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
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from '@/lib/actions/host-groups'
import type { HostGroupWithCount } from '@/lib/actions/host-groups'

const groupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
})
type GroupFormValues = z.infer<typeof groupSchema>

interface Props {
  orgId: string
  initialGroups: HostGroupWithCount[]
}

function GroupForm({
  defaultValues,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
}: {
  defaultValues: GroupFormValues
  onSubmit: (data: GroupFormValues) => void
  onCancel: () => void
  isPending: boolean
  submitLabel: string
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema),
    defaultValues,
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. Production Web Servers" {...register('name')} />
        {errors.name && (
          <p className="text-destructive text-sm">{errors.name.message}</p>
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
          placeholder="What hosts belong in this group and why?"
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

export function GroupsClient({ orgId, initialGroups }: Props) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<HostGroupWithCount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HostGroupWithCount | null>(null)

  const { data: groups = initialGroups } = useQuery({
    queryKey: ['host-groups', orgId],
    queryFn: () => listGroups(orgId),
    initialData: initialGroups,
  })

  const { mutate: doCreate, isPending: isCreating } = useMutation({
    mutationFn: (data: GroupFormValues) =>
      createGroup(orgId, { name: data.name, description: data.description || undefined }),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
      setCreateOpen(false)
    },
  })

  const { mutate: doUpdate, isPending: isUpdating } = useMutation({
    mutationFn: (data: GroupFormValues) =>
      updateGroup(orgId, editGroup!.id, { name: data.name, description: data.description || undefined }),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
      setEditGroup(null)
    },
  })

  const { mutate: doDelete, isPending: isDeleting } = useMutation({
    mutationFn: (groupId: string) => deleteGroup(orgId, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-groups', orgId] })
      setDeleteTarget(null)
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Host Groups</h1>
            <p className="text-sm text-muted-foreground">
              Organise hosts into named groups for batch operations
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1" />
          New Group
        </Button>
      </div>

      {/* Table */}
      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Layers className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No groups yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a group to organise hosts and run batch operations against them.
          </p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" />
            New Group
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Hosts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <Link
                      href={`/hosts/groups/${group.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {group.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="size-3.5" />
                      {group.hostCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(group.createdAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditGroup(group)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(group)}
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
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <GroupForm
            defaultValues={{ name: '', description: '' }}
            onSubmit={(d) => doCreate(d)}
            onCancel={() => setCreateOpen(false)}
            isPending={isCreating}
            submitLabel="Create Group"
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editGroup}
        onOpenChange={(open) => { if (!open) setEditGroup(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          {editGroup && (
            <GroupForm
              defaultValues={{ name: editGroup.name, description: editGroup.description ?? '' }}
              onSubmit={(d) => doUpdate(d)}
              onCancel={() => setEditGroup(null)}
              isPending={isUpdating}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the group and all its host memberships. Hosts themselves will not be affected.
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
