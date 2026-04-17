'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  Loader2,
  User,
  Mail,
  FolderTree,
  Lock,
  Clock,
  KeyRound,
  Users,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Copy,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { searchLdapDirectory, lookupDirectoryUser } from '@/lib/actions/ldap'
import type { LdapUserResult, LdapUserDetailResult, LookupConfigOption } from '@/lib/actions/ldap'

function extractCn(dn: string): string {
  const match = dn.match(/^cn=([^,]+)/i)
  return match?.[1] ?? dn
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text)
}

// Attributes that store a Windows file time (100-nanosecond intervals since 1601-01-01 UTC).
const AD_FILETIME_ATTRS = new Set([
  'accountexpires',
  'badpasswordtime',
  'pwdlastset',
  'lastlogon',
  'lastlogontimestamp',
  'lastlogoff',
  'lockouttime',
  'msds-userpasswordexpirytimecomputed',
  'msds-lastsuccessfulinteractivelogontime',
  'msds-lastfailedinteractivelogontime',
])

// Attributes stored as LDAP Generalized Time (YYYYMMDDHHMMSS[.f]Z).
const GENERALIZED_TIME_ATTRS = new Set([
  'whencreated',
  'whenchanged',
  'pwdchangedtime',
  'createtimestamp',
  'modifytimestamp',
])

const AD_EPOCH_DIFF_MS = BigInt('11644473600000')
const AD_NEVER_MAX = BigInt('9223372036854775807')

function formatAdFileTime(raw: string): string | null {
  let n: bigint
  try {
    n = BigInt(raw.trim())
  } catch {
    return null
  }
  if (n <= BigInt(0) || n === AD_NEVER_MAX) return 'Never'
  const ms = Number(n / BigInt(10000) - AD_EPOCH_DIFF_MS)
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString()
}

function formatGeneralizedTime(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, day, h, mi, s] = m
  const d = new Date(`${y}-${mo}-${day}T${h}:${mi}:${s}Z`)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString()
}

function humaniseTimestamp(key: string, value: string): string | null {
  const k = key.toLowerCase()
  if (AD_FILETIME_ATTRS.has(k)) return formatAdFileTime(value)
  if (GENERALIZED_TIME_ATTRS.has(k)) return formatGeneralizedTime(value)
  return null
}

export function DirectoryLookupClient({
  orgId,
  configs,
}: {
  orgId: string
  configs: LookupConfigOption[]
}) {
  const [configId, setConfigId] = useState<string>(configs[0]!.id)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<LdapUserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedUser, setSelectedUser] = useState<LdapUserDetailResult | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [groupFilter, setGroupFilter] = useState('')
  const [attrFilter, setAttrFilter] = useState('')
  const [showAllAttrs, setShowAllAttrs] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const configIdRef = useRef(configId)
  useEffect(() => { configIdRef.current = configId }, [configId])

  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  // Flip once after mount so the portal only renders on the client (document.body is not available during SSR).
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot flag to detect client render; required because 'use client' components still run on the server.
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!showSuggestions) return
    function update() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [showSuggestions, suggestions.length])

  // Reset state on config change
  function handleConfigChange(newConfigId: string) {
    setConfigId(newConfigId)
    setQuery('')
    setSuggestions([])
    setShowSuggestions(false)
    setSelectedUser(null)
    setError(null)
  }

  const handleQueryInput = useCallback((value: string) => {
    setQuery(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!value.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      const cid = configIdRef.current
      setSearching(true)
      try {
        const result = await searchLdapDirectory(orgId, cid, value.trim())
        if ('error' in result) {
          setError(result.error)
          setSuggestions([])
          setShowSuggestions(false)
        } else {
          setError(null)
          setSuggestions(result.users)
          setShowSuggestions(result.users.length > 0)
        }
      } catch (err) {
        setError(
          err instanceof Error && err.message.includes('Server Action')
            ? 'This page is out of date. Please reload (Cmd+Shift+R / Ctrl+Shift+R).'
            : err instanceof Error ? err.message : 'Directory search failed.'
        )
        setSuggestions([])
        setShowSuggestions(false)
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [orgId])

  async function selectUser(user: LdapUserResult) {
    setShowSuggestions(false)
    setSuggestions([])
    setQuery(user.username)
    setLoadingDetail(true)
    setError(null)
    setSelectedUser(null)
    setGroupFilter('')
    setAttrFilter('')

    try {
      const result = await lookupDirectoryUser(orgId, configId, user.dn)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setSelectedUser(result.user)
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes('Server Action')
          ? 'This page is out of date. Please reload (Cmd+Shift+R / Ctrl+Shift+R).'
          : err instanceof Error ? err.message : 'Directory lookup failed.'
      )
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      const insideAnchor = anchorRef.current?.contains(target)
      const insideDropdown = dropdownRef.current?.contains(target)
      if (!insideAnchor && !insideDropdown) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredGroups = useMemo(() => {
    if (!selectedUser) return []
    const f = groupFilter.trim().toLowerCase()
    if (!f) return selectedUser.groups
    return selectedUser.groups.filter((g) => g.toLowerCase().includes(f))
  }, [selectedUser, groupFilter])

  const filteredAttrs = useMemo(() => {
    if (!selectedUser) return []
    const entries = Object.entries(selectedUser.rawAttributes).sort(([a], [b]) => a.localeCompare(b))
    const f = attrFilter.trim().toLowerCase()
    if (!f) return entries
    return entries.filter(([key, value]) => {
      if (key.toLowerCase().includes(f)) return true
      const valStr = Array.isArray(value) ? value.join(' ') : value
      return valStr.toLowerCase().includes(f)
    })
  }, [selectedUser, attrFilter])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Directory User Lookup</h1>
        <p className="text-muted-foreground mt-1">
          Search for a user in your connected LDAP or Active Directory. Results are fetched live — nothing is synced or stored.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {configs.length > 1 && (
            <div className="space-y-1.5">
              <Label>Directory Server</Label>
              <Select value={configId} onValueChange={handleConfigChange}>
                <SelectTrigger className="w-full md:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="lookup-username">Username</Label>
            <div className="relative" ref={anchorRef}>
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                id="lookup-username"
                value={query}
                onChange={(e) => handleQueryInput(e.target.value)}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                placeholder="Start typing a username..."
                autoComplete="off"
                className="pl-9"
              />
              {(searching || loadingDetail) && (
                <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {mounted && showSuggestions && dropdownPos && createPortal(
              <div
                ref={dropdownRef}
                className="fixed z-50 rounded-md border bg-popover shadow-md"
                style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
              >
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
              </div>,
              document.body,
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedUser && (
        <>
          {/* User summary card */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-xl flex items-center gap-3">
                    {selectedUser.displayName ?? selectedUser.username}
                    {selectedUser.accountLocked ? (
                      <Badge className="bg-red-100 text-red-800 border-red-200">
                        <Lock className="size-3 mr-1" />
                        Locked
                      </Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 border-green-200">
                        <CheckCircle className="size-3 mr-1" />
                        Active
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-mono">
                    {selectedUser.username}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground flex items-center gap-1.5 mb-1">
                    <Mail className="size-3.5" /> Email
                  </dt>
                  <dd className="font-medium break-all">{selectedUser.email ?? '—'}</dd>
                </div>
                {selectedUser.samAccountName && (
                  <div>
                    <dt className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <User className="size-3.5" /> sAMAccountName
                    </dt>
                    <dd className="font-mono text-xs">{selectedUser.samAccountName}</dd>
                  </div>
                )}
                {selectedUser.userPrincipalName && (
                  <div>
                    <dt className="text-muted-foreground flex items-center gap-1.5 mb-1">
                      <User className="size-3.5" /> User Principal Name
                    </dt>
                    <dd className="font-mono text-xs break-all">{selectedUser.userPrincipalName}</dd>
                  </div>
                )}
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground flex items-center gap-1.5 mb-1">
                    <FolderTree className="size-3.5" /> Distinguished Name
                  </dt>
                  <dd className="font-mono text-xs flex items-start gap-2 break-all">
                    <span className="flex-1">{selectedUser.dn}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 shrink-0"
                      onClick={() => copyToClipboard(selectedUser.dn)}
                      title="Copy DN"
                    >
                      <Copy className="size-3" />
                    </Button>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Password card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="size-4" />
                Password
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="size-3.5" /> Expires
                  </span>
                  <div className="mt-1 font-medium">
                    {selectedUser.passwordExpiresAt ? (
                      (() => {
                        const expiry = new Date(selectedUser.passwordExpiresAt)
                        const isExpired = expiry < new Date()
                        return (
                          <span className={isExpired ? 'text-red-600' : ''}>
                            {isExpired ? 'Expired ' : ''}
                            {formatDistanceToNow(expiry, { addSuffix: true })}
                            <span className="text-muted-foreground ml-2 text-xs">
                              ({expiry.toLocaleDateString()})
                            </span>
                          </span>
                        )
                      })()
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Changed</span>
                  <div className="mt-1 font-medium">
                    {selectedUser.passwordLastChangedAt
                      ? formatDistanceToNow(new Date(selectedUser.passwordLastChangedAt), { addSuffix: true })
                      : <span className="text-muted-foreground">Unknown</span>
                    }
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Lock className="size-3.5" /> Account Locked
                  </span>
                  <div className="mt-1 font-medium flex items-center gap-1.5">
                    {selectedUser.accountLocked ? (
                      <><XCircle className="size-4 text-red-600" /> Yes</>
                    ) : (
                      <><CheckCircle className="size-4 text-green-600" /> No</>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Groups card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="size-4" />
                  Groups
                  <Badge variant="outline">{selectedUser.groups.length}</Badge>
                </CardTitle>
                {selectedUser.groups.length > 0 && (
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Filter groups..."
                      className="pl-8 h-8 text-sm"
                      value={groupFilter}
                      onChange={(e) => setGroupFilter(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {selectedUser.groups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No group memberships.</p>
              ) : filteredGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No groups match &ldquo;{groupFilter}&rdquo;.</p>
              ) : (
                <ul className="divide-y border rounded-md max-h-96 overflow-y-auto">
                  {filteredGroups.map((group) => (
                    <li key={group} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{extractCn(group)}</p>
                        <p className="text-xs text-muted-foreground font-mono break-all">{group}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 shrink-0"
                        onClick={() => copyToClipboard(group)}
                        title="Copy DN"
                      >
                        <Copy className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* All attributes card */}
          <Card>
            <CardHeader>
              <button
                type="button"
                onClick={() => setShowAllAttrs((prev) => !prev)}
                className="flex items-center justify-between w-full text-left"
              >
                <CardTitle className="text-base flex items-center gap-2">
                  {showAllAttrs ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  All LDAP Attributes
                  <Badge variant="outline">{Object.keys(selectedUser.rawAttributes).length}</Badge>
                </CardTitle>
              </button>
            </CardHeader>
            {showAllAttrs && (
              <CardContent className="space-y-3">
                <div className="relative max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter attributes..."
                    className="pl-8 h-8 text-sm"
                    value={attrFilter}
                    onChange={(e) => setAttrFilter(e.target.value)}
                  />
                </div>
                {filteredAttrs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No attributes match &ldquo;{attrFilter}&rdquo;.</p>
                ) : (
                  <div className="border rounded-md divide-y max-h-[30rem] overflow-y-auto">
                    {filteredAttrs.map(([key, value]) => {
                      const humanised = !Array.isArray(value) ? humaniseTimestamp(key, value) : null
                      return (
                        <div key={key} className="grid grid-cols-[minmax(0,12rem)_1fr] gap-4 px-3 py-2 text-sm">
                          <div className="font-mono text-xs font-medium text-foreground break-all">{key}</div>
                          <div className="font-mono text-xs text-muted-foreground break-all whitespace-pre-wrap">
                            {humanised ? (
                              <div>
                                <div className="font-sans text-xs text-foreground">{humanised}</div>
                                <div className="text-[10px] opacity-60 mt-0.5">raw: {value}</div>
                              </div>
                            ) : Array.isArray(value) ? (
                              <ul className="space-y-1">
                                {value.map((v, i) => <li key={i}>{v}</li>)}
                              </ul>
                            ) : (
                              value
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
