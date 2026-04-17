'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  Users, Search, Key, Plus, CheckCircle, XCircle, Lock, Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getDomainAccounts,
  getDomainAccountCounts,
  createDomainAccount,
} from '@/lib/actions/domain-accounts'
import type { DomainAccountCounts, DomainAccountListFilters } from '@/lib/actions/domain-accounts'
import type { DomainAccount, DomainAccountStatus } from '@/lib/db/schema'

function StatusBadge({ status }: { status: DomainAccountStatus }) {
  switch (status) {
    case 'active':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          Active
        </Badge>
      )
    case 'disabled':
      return (
        <Badge className="bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100">
          Disabled
        </Badge>
      )
    case 'locked':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          Locked
        </Badge>
      )
    case 'expired':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          Expired
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function SummaryCard({
  title,
  count,
  icon: Icon,
  colorClass,
  onClick,
  active,
}: {
  title: string
  count: number
  icon: React.ElementType
  colorClass: string
  onClick: () => void
  active: boolean
}) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${active ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className={`size-4 ${colorClass}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${colorClass}`}>{count}</div>
      </CardContent>
    </Card>
  )
}

const INITIAL_ADD_FORM = {
  username: '',
  displayName: '',
  email: '',
  passwordExpiresAt: '',
}

export function ServiceAccountsClient({
  orgId,
  initialAccounts,
  initialCounts,
}: {
  orgId: string
  initialAccounts: DomainAccount[]
  initialCounts: DomainAccountCounts
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<DomainAccountStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({ ...INITIAL_ADD_FORM })
  const [addError, setAddError] = useState<string | null>(null)

  const filters: DomainAccountListFilters = {
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(searchTerm !== '' ? { search: searchTerm } : {}),
    sortBy: 'username',
    sortDir: 'asc',
    limit: 100,
  }

  const { data: accounts = initialAccounts } = useQuery({
    queryKey: ['domain-accounts', orgId, filters],
    queryFn: () => getDomainAccounts(orgId, filters),
    initialData: initialAccounts,
    staleTime: 30_000,
  })

  const { data: counts = initialCounts } = useQuery({
    queryKey: ['domain-account-counts', orgId],
    queryFn: () => getDomainAccountCounts(orgId),
    initialData: initialCounts,
    staleTime: 30_000,
  })

  const canAdd = addForm.username.trim().length > 0

  const addMutation = useMutation({
    mutationFn: () =>
      createDomainAccount(orgId, {
        username: addForm.username,
        displayName: addForm.displayName,
        email: addForm.email,
        passwordExpiresAt: addForm.passwordExpiresAt || null,
      }),
    onSuccess: (result) => {
      if ('error' in result) {
        setAddError(result.error)
        return
      }
      resetAddDialog()
      queryClient.invalidateQueries({ queryKey: ['domain-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['domain-account-counts'] })
    },
  })

  function resetAddDialog() {
    setShowAddDialog(false)
    setAddForm({ ...INITIAL_ADD_FORM })
    setAddError(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Service Accounts</h1>
          <p className="text-muted-foreground mt-1">
            {counts.total} service account{counts.total !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={(open) => { if (!open) resetAddDialog(); else setShowAddDialog(true) }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Service Account</DialogTitle>
              <DialogDescription>
                Track a service account by username. Details can be edited later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-username">Username</Label>
                <Input
                  id="add-username"
                  value={addForm.username}
                  onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                  placeholder="e.g. svc-deploy"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-displayname">Display Name</Label>
                <Input
                  id="add-displayname"
                  value={addForm.displayName}
                  onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })}
                  placeholder="e.g. Deploy Service Account"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-email">Email</Label>
                <Input
                  id="add-email"
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  placeholder="e.g. svc-deploy@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-password-expires">Password Expiry Date</Label>
                <Input
                  id="add-password-expires"
                  type="date"
                  value={addForm.passwordExpiresAt}
                  onChange={(e) => setAddForm({ ...addForm, passwordExpiresAt: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  When does this account&apos;s password expire? Leave blank if it doesn&apos;t expire.
                </p>
              </div>

              {addError && (
                <p className="text-sm text-destructive">{addError}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetAddDialog}>
                Cancel
              </Button>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !canAdd}
              >
                {addMutation.isPending ? 'Adding...' : 'Add Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard
          title="Total"
          count={counts.total}
          icon={Users}
          colorClass="text-foreground"
          onClick={() => setStatusFilter('all')}
          active={statusFilter === 'all'}
        />
        <SummaryCard
          title="Active"
          count={counts.active}
          icon={CheckCircle}
          colorClass="text-green-600"
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          active={statusFilter === 'active'}
        />
        <SummaryCard
          title="Disabled"
          count={counts.disabled}
          icon={XCircle}
          colorClass="text-gray-500"
          onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}
          active={statusFilter === 'disabled'}
        />
        <SummaryCard
          title="Locked"
          count={counts.locked}
          icon={Lock}
          colorClass="text-red-600"
          onClick={() => setStatusFilter(statusFilter === 'locked' ? 'all' : 'locked')}
          active={statusFilter === 'locked'}
        />
        <SummaryCard
          title="Expired"
          count={counts.expired}
          icon={Clock}
          colorClass="text-amber-600"
          onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')}
          active={statusFilter === 'expired'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by username or display name..."
            className="pl-9 w-72"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as DomainAccountStatus | 'all')}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="locked">Locked</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Key className="size-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No service accounts found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add service accounts to track and monitor their status.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Password Expires</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acct) => (
                <TableRow
                  key={acct.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/service-accounts/${acct.id}`)}
                >
                  <TableCell className="font-medium font-mono">{acct.username}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {acct.displayName ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {acct.email ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {acct.passwordExpiresAt
                      ? new Date(acct.passwordExpiresAt).toLocaleDateString()
                      : <span className="text-muted-foreground/60">Never</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={acct.status as DomainAccountStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
