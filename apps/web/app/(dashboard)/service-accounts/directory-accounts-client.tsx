'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Users, Search, Key, Plus, FolderTree, UserPlus, Globe } from 'lucide-react'
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
import type { DomainAccount, DomainAccountSource, DomainAccountStatus } from '@/lib/db/schema'

function SourceBadge({ source }: { source: DomainAccountSource }) {
  switch (source) {
    case 'ldap':
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
          LDAP
        </Badge>
      )
    case 'active_directory':
      return (
        <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100">
          Active Directory
        </Badge>
      )
    case 'manual':
      return (
        <Badge variant="outline">
          Manual
        </Badge>
      )
    default:
      return <Badge variant="outline">{source}</Badge>
  }
}

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

export function DirectoryAccountsClient({
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

  const [sourceFilter, setSourceFilter] = useState<DomainAccountSource | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<DomainAccountStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({
    username: '',
    displayName: '',
    email: '',
    source: 'manual' as DomainAccountSource,
  })
  const [addError, setAddError] = useState<string | null>(null)

  const filters: DomainAccountListFilters = {
    ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
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

  const addMutation = useMutation({
    mutationFn: (data: typeof addForm) => createDomainAccount(orgId, data),
    onSuccess: (result) => {
      if ('error' in result) {
        setAddError(result.error)
        return
      }
      setShowAddDialog(false)
      setAddForm({ username: '', displayName: '', email: '', source: 'manual' })
      setAddError(null)
      queryClient.invalidateQueries({ queryKey: ['domain-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['domain-account-counts'] })
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Directory Accounts</h1>
          <p className="text-muted-foreground mt-1">
            {counts.total} account{counts.total !== 1 ? 's' : ''} from directory services and manual entries
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Directory Account</DialogTitle>
              <DialogDescription>
                Manually add a network or domain account to track.
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
                <Label htmlFor="add-source">Source</Label>
                <Select
                  value={addForm.source}
                  onValueChange={(v) => setAddForm({ ...addForm, source: v as DomainAccountSource })}
                >
                  <SelectTrigger id="add-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="ldap">LDAP</SelectItem>
                    <SelectItem value="active_directory">Active Directory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {addError && (
                <p className="text-sm text-destructive">{addError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowAddDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => addMutation.mutate(addForm)}
                disabled={addMutation.isPending || !addForm.username.trim()}
              >
                {addMutation.isPending ? 'Adding...' : 'Add Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="LDAP"
          count={counts.ldap}
          icon={FolderTree}
          colorClass="text-blue-600"
          onClick={() => setSourceFilter(sourceFilter === 'ldap' ? 'all' : 'ldap')}
          active={sourceFilter === 'ldap'}
        />
        <SummaryCard
          title="Active Directory"
          count={counts.activeDirectory}
          icon={Globe}
          colorClass="text-purple-600"
          onClick={() => setSourceFilter(sourceFilter === 'active_directory' ? 'all' : 'active_directory')}
          active={sourceFilter === 'active_directory'}
        />
        <SummaryCard
          title="Manual"
          count={counts.manual}
          icon={UserPlus}
          colorClass="text-gray-600"
          onClick={() => setSourceFilter(sourceFilter === 'manual' ? 'all' : 'manual')}
          active={sourceFilter === 'manual'}
        />
        <SummaryCard
          title="Total"
          count={counts.total}
          icon={Users}
          colorClass="text-foreground"
          onClick={() => setSourceFilter('all')}
          active={sourceFilter === 'all'}
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
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as DomainAccountSource | 'all')}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="ldap">LDAP</SelectItem>
            <SelectItem value="active_directory">Active Directory</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
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
          <p className="text-muted-foreground font-medium">No directory accounts found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add accounts manually or configure LDAP to sync from your directory service.
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
                <TableHead>Source</TableHead>
                <TableHead>Groups</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Synced</TableHead>
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
                  <TableCell>
                    <SourceBadge source={acct.source as DomainAccountSource} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-48 truncate">
                    {(acct.groups ?? []).length > 0
                      ? (acct.groups ?? []).join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={acct.status as DomainAccountStatus} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {acct.lastSyncedAt
                      ? formatDistanceToNow(new Date(acct.lastSyncedAt), { addSuffix: true })
                      : '—'}
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
