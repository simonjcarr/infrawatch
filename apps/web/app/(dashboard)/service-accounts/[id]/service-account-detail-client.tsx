'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  User,
  Mail,
  Shield,
  Pencil,
  Trash2,
  Clock,
  KeyRound,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { updateDomainAccount, deleteDomainAccount } from '@/lib/actions/domain-accounts'
import type { DomainAccount, DomainAccountStatus } from '@/lib/db/schema'

function StatusBadge({ status }: { status: DomainAccountStatus }) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Active</Badge>
    case 'disabled':
      return <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">Disabled</Badge>
    case 'locked':
      return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Locked</Badge>
    case 'expired':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Expired</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function InfoCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | React.ReactNode
  icon: React.ElementType
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold break-all">{value}</div>
      </CardContent>
    </Card>
  )
}

export function ServiceAccountDetailClient({
  orgId,
  account,
}: {
  orgId: string
  account: DomainAccount
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    displayName: account.displayName ?? '',
    email: account.email ?? '',
    status: account.status as DomainAccountStatus,
    passwordExpiresAt: account.passwordExpiresAt
      ? new Date(account.passwordExpiresAt).toISOString().split('T')[0]
      : '',
  })
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const updateMutation = useMutation({
    mutationFn: () => updateDomainAccount(orgId, account.id, {
      displayName: editForm.displayName,
      email: editForm.email,
      status: editForm.status,
      passwordExpiresAt: editForm.passwordExpiresAt || null,
    }),
    onSuccess: (result) => {
      if ('error' in result) return
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['domain-accounts'] })
      router.refresh()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteDomainAccount(orgId, account.id),
    onSuccess: (result) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['domain-accounts'] })
      router.push('/service-accounts')
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/service-accounts">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground font-mono">
              {account.username}
            </h1>
            <StatusBadge status={account.status as DomainAccountStatus} />
          </div>
          {account.displayName && (
            <p className="text-muted-foreground mt-1">{account.displayName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(!editing)}
          >
            <Pencil className="size-4 mr-1.5" />
            Edit
          </Button>
          <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="size-4 mr-1.5" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Account</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete the account &quot;{account.username}&quot;? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                value={editForm.displayName}
                onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v as DomainAccountStatus })}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Password Expiry Date</Label>
              <Input
                type="date"
                value={editForm.passwordExpiresAt}
                onChange={(e) => setEditForm({ ...editForm, passwordExpiresAt: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if the password doesn&apos;t expire.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <InfoCard label="Username" value={account.username} icon={User} />
        <InfoCard label="Email" value={account.email ?? '—'} icon={Mail} />
        <InfoCard label="Status" value={<StatusBadge status={account.status as DomainAccountStatus} />} icon={Shield} />
      </div>

      {/* Password expiry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="size-4" />
            Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Clock className="size-3.5" />
              Password Expires
            </span>
            <div className="mt-1 font-medium">
              {account.passwordExpiresAt ? (
                (() => {
                  const expiry = new Date(account.passwordExpiresAt)
                  const isExpired = expiry < new Date()
                  return (
                    <span className={isExpired ? 'text-red-600' : ''}>
                      {isExpired ? 'Expired ' : ''}
                      {formatDistanceToNow(expiry, { addSuffix: true })}
                    </span>
                  )
                })()
              ) : (
                <span className="text-muted-foreground">Never</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timestamps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timestamps</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium mt-0.5">{formatDate(account.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="font-medium mt-0.5">{formatDate(account.updatedAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
