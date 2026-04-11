'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  Users, Search, Key, Plus, CheckCircle, XCircle, Lock, Clock, Loader2,
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
import { searchLdapDirectory } from '@/lib/actions/ldap'
import type { LdapUserResult } from '@/lib/actions/ldap'
import type { DomainAccountCounts, DomainAccountListFilters, LdapConfigOption } from '@/lib/actions/domain-accounts'
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
  ldapConfigurationId: null as string | null,
  passwordExpiresAt: '',
}

export function ServiceAccountsClient({
  orgId,
  initialAccounts,
  initialCounts,
  ldapConfigs,
}: {
  orgId: string
  initialAccounts: DomainAccount[]
  initialCounts: DomainAccountCounts
  ldapConfigs: LdapConfigOption[]
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<DomainAccountStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({ ...INITIAL_ADD_FORM })
  const [addError, setAddError] = useState<string | null>(null)

  // Typeahead state
  const [selectedUser, setSelectedUser] = useState<LdapUserResult | null>(null)
  const [suggestions, setSuggestions] = useState<LdapUserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

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

  const isDirectoryMode = addForm.ldapConfigurationId !== null
  const canAdd = isDirectoryMode ? selectedUser !== null : addForm.username.trim().length > 0

  const addMutation = useMutation({
    mutationFn: () => {
      if (isDirectoryMode && selectedUser) {
        return createDomainAccount(orgId, {
          username: selectedUser.username,
          displayName: selectedUser.displayName ?? '',
          email: selectedUser.email ?? '',
          ldapConfigurationId: addForm.ldapConfigurationId,
          distinguishedName: selectedUser.dn,
          samAccountName: selectedUser.samAccountName,
          userPrincipalName: selectedUser.userPrincipalName,
          groups: selectedUser.groups,
          accountLocked: selectedUser.accountLocked,
          passwordExpiresAt: selectedUser.passwordExpiresAt,
          passwordLastChangedAt: selectedUser.passwordLastChangedAt,
        })
      }
      return createDomainAccount(orgId, {
        username: addForm.username,
        displayName: addForm.displayName,
        email: addForm.email,
        ldapConfigurationId: null,
        passwordExpiresAt: addForm.passwordExpiresAt || null,
      })
    },
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
    setSelectedUser(null)
    setSuggestions([])
    setShowSuggestions(false)
    setSearching(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  const handleDirectoryServerChange = useCallback((value: string) => {
    setAddForm((prev) => ({
      ...prev,
      ldapConfigurationId: value === 'none' ? null : value,
      username: '',
    }))
    setSelectedUser(null)
    setSuggestions([])
    setShowSuggestions(false)
    setAddError(null)
  }, [])

  // Use a ref for the config ID so the debounced callback always has the latest value.
  const configIdRef = useRef(addForm.ldapConfigurationId)
  useEffect(() => { configIdRef.current = addForm.ldapConfigurationId }, [addForm.ldapConfigurationId])

  // Debounced LDAP search as the user types
  const handleUsernameInput = useCallback((value: string) => {
    setAddForm((prev) => ({ ...prev, username: value }))
    setSelectedUser(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!value.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      const configId = configIdRef.current
      if (!configId) return
      setSearching(true)
      const result = await searchLdapDirectory(orgId, configId, value.trim())
      setSearching(false)
      if ('error' in result) {
        setSuggestions([])
        setShowSuggestions(false)
      } else {
        setSuggestions(result.users)
        setShowSuggestions(result.users.length > 0)
      }
    }, 300)
  }, [orgId])

  function selectUser(user: LdapUserResult) {
    setSelectedUser(user)
    setAddForm((prev) => ({
      ...prev,
      username: user.username,
      displayName: user.displayName ?? '',
      email: user.email ?? '',
    }))
    setShowSuggestions(false)
    setSuggestions([])
  }

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function getLdapConfigName(configId: string | null): string | null {
    if (!configId) return null
    return ldapConfigs.find((c) => c.id === configId)?.name ?? null
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
                Add a service account to track. If on a directory server, the account will be verified and details pulled automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Directory Server</Label>
                <Select
                  value={addForm.ldapConfigurationId ?? 'none'}
                  onValueChange={handleDirectoryServerChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a directory server..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (not on a directory)</SelectItem>
                    {ldapConfigs.map((config) => (
                      <SelectItem key={config.id} value={config.id}>
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Username with typeahead (directory mode) */}
              {isDirectoryMode && (
                <div className="space-y-1.5">
                  <Label htmlFor="add-username">Username</Label>
                  <div className="relative" ref={suggestionsRef}>
                    <div className="relative">
                      <Input
                        id="add-username"
                        value={addForm.username}
                        onChange={(e) => handleUsernameInput(e.target.value)}
                        onFocus={() => { if (suggestions.length > 0 && !selectedUser) setShowSuggestions(true) }}
                        placeholder="Start typing to search the directory..."
                        disabled={selectedUser !== null}
                        autoComplete="off"
                      />
                      {searching && (
                        <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {selectedUser && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-0.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSelectedUser(null)
                          setAddForm((prev) => ({ ...prev, username: '', displayName: '', email: '' }))
                        }}
                      >
                        Clear
                      </Button>
                    )}

                    {/* Suggestions dropdown */}
                    {showSuggestions && !selectedUser && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                        {suggestions.map((user) => (
                          <button
                            key={user.dn}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-accent transition-colors first:rounded-t-md last:rounded-b-md"
                            onClick={() => selectUser(user)}
                          >
                            <p className="font-medium font-mono text-sm">{user.username}</p>
                            {user.displayName && (
                              <p className="text-xs text-muted-foreground">{user.displayName}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedUser && (
                    <p className="text-sm text-green-700 flex items-center gap-1.5">
                      <CheckCircle className="size-3.5 shrink-0" />
                      Account found in directory
                    </p>
                  )}
                </div>
              )}

              {/* Username (manual mode) */}
              {!isDirectoryMode && (
                <div className="space-y-1.5">
                  <Label htmlFor="add-username-manual">Username</Label>
                  <Input
                    id="add-username-manual"
                    value={addForm.username}
                    onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                    placeholder="e.g. svc-deploy"
                  />
                </div>
              )}

              {/* Directory user details (verified) */}
              {isDirectoryMode && selectedUser && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Display Name</span>
                    <p className="font-medium break-words">{selectedUser.displayName ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Email</span>
                    <p className="font-medium break-all">{selectedUser.email ?? '—'}</p>
                  </div>
                  {selectedUser.groups.length > 0 && (
                    <div>
                      <span className="text-muted-foreground text-xs">Groups</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedUser.groups.map((g) => (
                          <Badge key={g} variant="outline" className="text-xs font-mono break-all">
                            {g}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-muted-foreground text-xs">Account Locked</span>
                      <p className="font-medium flex items-center gap-1.5">
                        {selectedUser.accountLocked ? (
                          <><XCircle className="size-3.5 text-red-600 shrink-0" /> Yes</>
                        ) : (
                          <><CheckCircle className="size-3.5 text-green-600 shrink-0" /> No</>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Password Expires</span>
                      <p className="font-medium">
                        {selectedUser.passwordExpiresAt
                          ? new Date(selectedUser.passwordExpiresAt).toLocaleDateString()
                          : 'Never'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Manual entry fields */}
              {!isDirectoryMode && (
                <>
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
                </>
              )}

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
                <TableHead>Directory</TableHead>
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
                    {acct.ldapConfigurationId
                      ? (getLdapConfigName(acct.ldapConfigurationId) ?? 'LDAP')
                      : <span className="text-muted-foreground/60">None</span>}
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
