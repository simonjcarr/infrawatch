'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, UserPlus, Link2, X, UserX, UserCheck, Trash2, Check } from 'lucide-react'
import { getOrgUsers, inviteUser, updateUserRole, deactivateUser, reactivateUser, removeUser, cancelInvite } from '@/lib/actions/users'
import type { User, Invitation } from '@/lib/db/schema'
import { cn } from '@/lib/utils'

const ROLES = ['super_admin', 'org_admin', 'engineer', 'read_only'] as const
const INVITE_ROLES = ['org_admin', 'engineer', 'read_only'] as const

function roleBadgeVariant(role: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'super_admin': return 'destructive'
    case 'org_admin': return 'default'
    case 'engineer': return 'secondary'
    case 'pending': return 'outline'
    default: return 'outline'
  }
}

function roleBadgeClassName(role: string): string {
  if (role === 'pending') return 'border-yellow-600 text-yellow-700 dark:border-yellow-500 dark:text-yellow-400'
  return ''
}

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['org_admin', 'engineer', 'read_only']),
})
type InviteValues = z.infer<typeof inviteSchema>

interface TeamClientProps {
  orgId: string
  currentUserId: string
  currentUserRole: string
  initialMembers: User[]
  initialPendingInvites: Invitation[]
}

const canManage = (role: string) => role === 'super_admin' || role === 'org_admin'

export function TeamClient({
  orgId,
  currentUserId,
  currentUserRole,
  initialMembers,
  initialPendingInvites,
}: TeamClientProps) {
  const queryClient = useQueryClient()
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const { data } = useQuery({
    queryKey: ['org-users', orgId],
    queryFn: () => getOrgUsers(orgId),
    initialData: { members: initialMembers, pendingInvites: initialPendingInvites },
  })

  const members = data?.members ?? []
  const pendingInvites = data?.pendingInvites ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['org-users', orgId] })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { role: 'engineer' } })

  const [inviteError, setInviteError] = useState<string | null>(null)

  const inviteMutation = useMutation({
    mutationFn: (values: InviteValues) => inviteUser(orgId, currentUserId, values),
    onSuccess: (result) => {
      if ('error' in result) {
        setInviteError(result.error)
        return
      }
      if ('restored' in result) {
        closeInviteDialog()
        invalidate()
        return
      }
      setInviteLink(result.inviteLink)
      invalidate()
    },
    onError: () => setInviteError('An unexpected error occurred'),
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateUserRole(orgId, userId, role),
    onSuccess: invalidate,
  })

  const deactivateMutation = useMutation({
    mutationFn: (targetId: string) => deactivateUser(orgId, currentUserId, targetId),
    onSuccess: invalidate,
  })

  const reactivateMutation = useMutation({
    mutationFn: (targetId: string) => reactivateUser(orgId, targetId),
    onSuccess: invalidate,
  })

  const removeMutation = useMutation({
    mutationFn: (targetId: string) => removeUser(orgId, currentUserId, targetId),
    onSuccess: invalidate,
  })

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => cancelInvite(orgId, inviteId),
    onSuccess: invalidate,
  })

  async function copyLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  function closeInviteDialog() {
    setIsInviteOpen(false)
    setInviteLink(null)
    setInviteError(null)
    setCopiedLink(false)
    reset()
  }

  function onInviteSubmit(values: InviteValues) {
    setInviteError(null)
    inviteMutation.mutate(values)
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage members and pending invitations
          </p>
        </div>
        {canManage(currentUserRole) && (
          <Button onClick={() => setIsInviteOpen(true)} size="sm">
            <UserPlus className="size-4 mr-2" />
            Invite member
          </Button>
        )}
      </div>

      {/* Members table */}
      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">
          Members ({members.length})
        </h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                {canManage(currentUserRole) && (
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((member) => (
                <tr key={member.id} className={cn(!member.isActive && 'opacity-60')}>
                  <td className="px-4 py-3 font-medium text-foreground">{member.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                  <td className="px-4 py-3">
                    {canManage(currentUserRole) && member.id !== currentUserId ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center gap-1 focus:outline-none">
                            <Badge variant={roleBadgeVariant(member.role)} className={roleBadgeClassName(member.role)}>
                              {member.role === 'pending' ? 'Pending Approval' : formatRole(member.role)}
                            </Badge>
                            <ChevronDown className="size-3 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {ROLES.map((r) => (
                            <DropdownMenuItem
                              key={r}
                              onClick={() =>
                                updateRoleMutation.mutate({ userId: member.id, role: r })
                              }
                              className={cn(member.role === r && 'font-medium')}
                            >
                              {formatRole(r)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Badge variant={roleBadgeVariant(member.role)} className={roleBadgeClassName(member.role)}>
                        {member.role === 'pending' ? 'Pending Approval' : formatRole(member.role)}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        member.isActive
                          ? 'border-green-600 text-green-700'
                          : 'border-border text-muted-foreground'
                      }
                    >
                      {member.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  {canManage(currentUserRole) && (
                    <td className="px-4 py-3 text-right">
                      {member.id !== currentUserId && (
                        <div className="flex items-center justify-end gap-2">
                          {member.isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => deactivateMutation.mutate(member.id)}
                              disabled={deactivateMutation.isPending}
                            >
                              <UserX className="size-4 mr-1" />
                              Deactivate
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-green-700 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                                onClick={() => reactivateMutation.mutate(member.id)}
                                disabled={reactivateMutation.isPending}
                              >
                                <UserCheck className="size-4 mr-1" />
                                Reactivate
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => removeMutation.mutate(member.id)}
                                disabled={removeMutation.isPending}
                              >
                                <Trash2 className="size-4 mr-1" />
                                Remove
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">
            Pending invitations ({pendingInvites.length})
          </h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Expires</th>
                  {canManage(currentUserRole) && (
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingInvites.map((invite) => (
                  <tr key={invite.id}>
                    <td className="px-4 py-3 text-foreground">{invite.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={roleBadgeVariant(invite.role)}>
                        {formatRole(invite.role)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {invite.expiresAt.toLocaleDateString()}
                    </td>
                    {canManage(currentUserRole) && (
                      <td className="px-4 py-3 text-right flex justify-end gap-2">
                        <CopyInviteLinkButton token={invite.token} />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => cancelInviteMutation.mutate(invite.id)}
                          disabled={cancelInviteMutation.isPending}
                        >
                          <X className="size-4 mr-1" />
                          Cancel
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Invite dialog */}
      <Dialog open={isInviteOpen} onOpenChange={(open) => { if (!open) closeInviteDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
          </DialogHeader>

          {inviteLink ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Invitation created. Share this link with the new member — it expires in 7 days.
              </p>
              <div className="flex gap-2">
                <Input value={inviteLink} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyLink}>
                  {copiedLink ? (
                    <Check className="size-4 text-green-600" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                </Button>
              </div>
              <Button className="w-full" onClick={closeInviteDialog}>
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onInviteSubmit)} className="space-y-4">
              {inviteError && (
                <p className="text-sm text-destructive">{inviteError}</p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@example.com"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  {...register('role')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {formatRole(r)}
                    </option>
                  ))}
                </select>
                {errors.role && (
                  <p className="text-xs text-destructive">{errors.role.message}</p>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={closeInviteDialog}>
                  Cancel
                </Button>
                <Button type="submit" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? 'Sending…' : 'Send invitation'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CopyInviteLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  async function handleCopy() {
    await navigator.clipboard.writeText(`${baseUrl}/register?invite=${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy}>
      {copied ? <Check className="size-4 mr-1 text-green-600" /> : <Link2 className="size-4 mr-1" />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  )
}
