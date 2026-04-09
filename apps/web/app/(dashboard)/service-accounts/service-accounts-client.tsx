'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Users, Cog, Server, AlertCircle, Search, Key } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AccountTypeBadge } from '@/components/service-accounts/account-type-badge'
import { AccountStatusBadge } from '@/components/service-accounts/account-status-badge'
import type {
  ServiceAccountCounts,
  ServiceAccountListFilters,
  ServiceAccountWithHost,
} from '@/lib/actions/service-accounts'
import type { ServiceAccountStatus, ServiceAccountType } from '@/lib/db/schema'

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

export function ServiceAccountsClient({
  orgId,
  initialAccounts,
  initialCounts,
}: {
  orgId: string
  initialAccounts: ServiceAccountWithHost[]
  initialCounts: ServiceAccountCounts
}) {
  const router = useRouter()

  const [typeFilter, setTypeFilter] = useState<ServiceAccountType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ServiceAccountStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<ServiceAccountListFilters['sortBy']>('username')

  const filters: ServiceAccountListFilters = {
    ...(typeFilter !== 'all' ? { accountType: typeFilter } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(searchTerm !== '' ? { search: searchTerm } : {}),
    sortBy,
    sortDir: 'asc',
    limit: 100,
  }

  const { data: accounts = initialAccounts } = useQuery({
    queryKey: ['service-accounts', orgId, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        ...(filters.accountType ? { accountType: filters.accountType } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search ? { search: filters.search } : {}),
        sortBy: filters.sortBy ?? 'username',
        sortDir: filters.sortDir ?? 'asc',
        limit: String(filters.limit ?? 100),
      })
      const res = await fetch(`/api/service-accounts?${params}`)
      if (!res.ok) throw new Error('Failed to fetch service accounts')
      return res.json() as Promise<ServiceAccountWithHost[]>
    },
    initialData: initialAccounts,
    staleTime: 30_000,
  })

  const { data: counts = initialCounts } = useQuery({
    queryKey: ['service-account-counts', orgId],
    queryFn: async () => {
      const res = await fetch('/api/service-accounts/counts')
      if (!res.ok) throw new Error('Failed to fetch service account counts')
      return res.json() as Promise<ServiceAccountCounts>
    },
    initialData: initialCounts,
    staleTime: 30_000,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Service Accounts</h1>
        <p className="text-muted-foreground mt-1">
          {counts.total} account{counts.total !== 1 ? 's' : ''} discovered across your infrastructure
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard
          title="Human"
          count={counts.human}
          icon={Users}
          colorClass="text-blue-600"
          onClick={() => setTypeFilter(typeFilter === 'human' ? 'all' : 'human')}
          active={typeFilter === 'human'}
        />
        <SummaryCard
          title="Service"
          count={counts.service}
          icon={Cog}
          colorClass="text-amber-600"
          onClick={() => setTypeFilter(typeFilter === 'service' ? 'all' : 'service')}
          active={typeFilter === 'service'}
        />
        <SummaryCard
          title="System"
          count={counts.system}
          icon={Server}
          colorClass="text-gray-600"
          onClick={() => setTypeFilter(typeFilter === 'system' ? 'all' : 'system')}
          active={typeFilter === 'system'}
        />
        <SummaryCard
          title="Disabled"
          count={counts.disabled}
          icon={AlertCircle}
          colorClass="text-gray-500"
          onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}
          active={statusFilter === 'disabled'}
        />
        <SummaryCard
          title="Missing"
          count={counts.missing}
          icon={AlertCircle}
          colorClass="text-red-600"
          onClick={() => setStatusFilter(statusFilter === 'missing' ? 'all' : 'missing')}
          active={statusFilter === 'missing'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by username..."
            className="pl-9 w-56"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as ServiceAccountType | 'all')}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="human">Human</SelectItem>
            <SelectItem value="service">Service</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as ServiceAccountStatus | 'all')}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(v) => setSortBy(v as ServiceAccountListFilters['sortBy'])}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="username">Username</SelectItem>
            <SelectItem value="uid">UID</SelectItem>
            <SelectItem value="last_seen">Last Seen</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Key className="size-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No service accounts found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add a service_account check to a host to start discovering system accounts.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>UID</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Shell</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SSH Keys</TableHead>
                <TableHead>Last Seen</TableHead>
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
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {acct.uid}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-40 truncate">
                    {acct.hostHostname ?? acct.hostId}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm max-w-48 truncate">
                    {acct.shell}
                  </TableCell>
                  <TableCell>
                    <AccountTypeBadge type={acct.accountType as ServiceAccountType} />
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge status={acct.status as ServiceAccountStatus} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {acct.sshKeyCount ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDistanceToNow(new Date(acct.lastSeenAt), { addSuffix: true })}
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
