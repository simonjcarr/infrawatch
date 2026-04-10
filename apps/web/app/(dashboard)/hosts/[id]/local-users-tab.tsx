'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Users, Search, Key } from 'lucide-react'
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
import { getServiceAccounts } from '@/lib/actions/service-accounts'
import type { ServiceAccountStatus, ServiceAccountType } from '@/lib/db/schema'

interface LocalUsersTabProps {
  orgId: string
  hostId: string
}

export function LocalUsersTab({ orgId, hostId }: LocalUsersTabProps) {
  const router = useRouter()
  const [typeFilter, setTypeFilter] = useState<ServiceAccountType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ServiceAccountStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['local-users', orgId, hostId, typeFilter, statusFilter, search],
    queryFn: () =>
      getServiceAccounts(orgId, {
        hostId,
        accountType: typeFilter === 'all' ? undefined : typeFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
        sortBy: 'username',
        sortDir: 'asc',
      }),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ServiceAccountType | 'all')}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="human">Human</SelectItem>
            <SelectItem value="service">Service</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ServiceAccountStatus | 'all')}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            Local Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading users...</div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-12">
              <Users className="size-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No local users discovered yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Users will appear after the agent runs a local user discovery check.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>Shell</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">SSH Keys</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow
                    key={account.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/hosts/${hostId}/users/${account.id}`)}
                  >
                    <TableCell className="font-medium font-mono text-sm">
                      {account.username}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {account.uid ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {account.shell ?? '—'}
                    </TableCell>
                    <TableCell>
                      <AccountTypeBadge type={account.accountType} />
                    </TableCell>
                    <TableCell>
                      <AccountStatusBadge status={account.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      {(account.sshKeyCount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Key className="size-3 text-muted-foreground" />
                          {account.sshKeyCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {account.lastSeenAt
                        ? formatDistanceToNow(new Date(account.lastSeenAt), { addSuffix: true })
                        : 'Never'}
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
