'use client'

import { Fragment, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { formatDistanceToNow } from 'date-fns'
import {
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  Save,
  Trash2,
  Loader2,
  Package,
  TrendingUp,
  GitBranch,
  AlertTriangle,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  getSoftwareReport,
  searchPackageNames,
  getNewPackages,
  getPackageDrift,
  listSavedReports,
  saveSoftwareReport,
  deleteSavedReport,
} from '@/lib/actions/software-inventory'
import type { SoftwareReportFilters, SoftwareReportRow, VersionMode } from '@/lib/actions/software-inventory'
import type { HostGroup } from '@/lib/db/schema'

interface Props {
  orgId: string
  orgName: string
  hostGroups: Pick<HostGroup, 'id' | 'name'>[]
}

type ActiveView = 'search' | 'new-packages' | 'drift'

const VERSION_MODE_LABELS: Record<VersionMode, string> = {
  any: 'Any version',
  exact: 'Exact',
  prefix: 'Starts with',
  between: 'Between',
}

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'dpkg', label: 'dpkg (Debian/Ubuntu)' },
  { value: 'rpm', label: 'rpm (RHEL/Fedora)' },
  { value: 'pacman', label: 'pacman (Arch)' },
  { value: 'apk', label: 'apk (Alpine)' },
  { value: 'winreg', label: 'Windows Registry' },
  { value: 'homebrew', label: 'Homebrew (macOS)' },
  { value: 'snap', label: 'Snap' },
  { value: 'flatpak', label: 'Flatpak' },
  { value: 'macapps', label: 'macOS Apps' },
]


export function SoftwareReportClient({ orgId, orgName, hostGroups }: Props) {
  const queryClient = useQueryClient()
  const [activeView, setActiveView] = useState<ActiveView>('search')

  // URL-synced filter state
  const [nameParam, setNameParam] = useQueryState('name', { defaultValue: '' })
  const [versionMode, setVersionMode] = useQueryState<VersionMode>('vm', {
    defaultValue: 'any',
    parse: (v) => (v as VersionMode) ?? 'any',
  })
  const [versionExact, setVersionExact] = useQueryState('ve', { defaultValue: '' })
  const [versionPrefix, setVersionPrefix] = useQueryState('vp', { defaultValue: '' })
  const [versionLow, setVersionLow] = useQueryState('vl', { defaultValue: '' })
  const [versionHigh, setVersionHigh] = useQueryState('vh', { defaultValue: '' })
  const [sourceFilter, setSourceFilter] = useQueryState('src', { defaultValue: '' })
  const [page, setPage] = useQueryState('p', { defaultValue: '1' })

  // Local state
  const [nameInput, setNameInput] = useState(nameParam)
  const [namePopoverOpen, setNamePopoverOpen] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [savedReportsOpen, setSavedReportsOpen] = useState(false)
  const [newWindowDays, setNewWindowDays] = useState<7 | 30>(7)

  const filters: SoftwareReportFilters = {
    name: nameParam || undefined,
    versionMode: versionMode as VersionMode,
    versionExact: versionExact || undefined,
    versionPrefix: versionPrefix || undefined,
    versionLow: versionLow || undefined,
    versionHigh: versionHigh || undefined,
    source: sourceFilter || undefined,
    page: parseInt(page, 10),
    pageSize: 50,
  }

  // Typeahead suggestions
  const { data: suggestions = [] } = useQuery({
    queryKey: ['pkg-name-suggestions', orgId, nameInput],
    queryFn: () => searchPackageNames(orgId, nameInput),
    enabled: nameInput.length >= 2,
    staleTime: 10_000,
  })

  // Main report
  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['software-report', orgId, filters],
    queryFn: () => getSoftwareReport(orgId, filters),
    enabled: activeView === 'search',
    staleTime: 30_000,
  })

  // New packages
  const { data: newPackages = [], isLoading: newLoading } = useQuery({
    queryKey: ['new-packages', orgId, newWindowDays],
    queryFn: () => getNewPackages(orgId, newWindowDays),
    enabled: activeView === 'new-packages',
    staleTime: 60_000,
  })

  // Package drift
  const { data: driftRows = [], isLoading: driftLoading } = useQuery({
    queryKey: ['package-drift', orgId],
    queryFn: () => getPackageDrift(orgId),
    enabled: activeView === 'drift',
    staleTime: 60_000,
  })

  // Saved reports
  const { data: savedReports = [] } = useQuery({
    queryKey: ['saved-software-reports', orgId],
    queryFn: () => listSavedReports(orgId),
  })

  const saveMutation = useMutation({
    mutationFn: () => saveSoftwareReport(orgId, saveName, filters),
    onSuccess: (result) => {
      if ('success' in result) {
        setSaveDialogOpen(false)
        setSaveName('')
        queryClient.invalidateQueries({ queryKey: ['saved-software-reports', orgId] })
      }
    },
  })

  const deleteSavedMutation = useMutation({
    mutationFn: (id: string) => deleteSavedReport(orgId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-software-reports', orgId] })
    },
  })

  function applyFilters(f: SoftwareReportFilters) {
    setNameParam(f.name ?? '')
    setNameInput(f.name ?? '')
    setVersionMode((f.versionMode ?? 'any') as VersionMode)
    setVersionExact(f.versionExact ?? '')
    setVersionPrefix(f.versionPrefix ?? '')
    setVersionLow(f.versionLow ?? '')
    setVersionHigh(f.versionHigh ?? '')
    setSourceFilter(f.source ?? '')
    setPage('1')
  }

  function loadSavedReport(filters: SoftwareReportFilters) {
    applyFilters(filters)
    setSavedReportsOpen(false)
    setActiveView('search')
  }

  function handleExport(format: 'csv' | 'pdf') {
    const params = new URLSearchParams()
    params.set('format', format)
    if (filters.name) params.set('name', filters.name)
    if (filters.versionMode && filters.versionMode !== 'any') params.set('vm', filters.versionMode)
    if (filters.versionExact) params.set('ve', filters.versionExact)
    if (filters.versionPrefix) params.set('vp', filters.versionPrefix)
    if (filters.versionLow) params.set('vl', filters.versionLow)
    if (filters.versionHigh) params.set('vh', filters.versionHigh)
    if (filters.source) params.set('src', filters.source)
    window.open(`/api/reports/software/export?${params.toString()}`, '_blank')
  }

  function toggleRowExpanded(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const currentPage = parseInt(page, 10)
  const totalPages = report ? Math.ceil(report.total / 50) : 0

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Installed Software</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search and report on software installed across your host estate.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setSavedReportsOpen(true)}>
            <Save className="size-3.5 mr-1.5" />
            Saved reports
            {savedReports.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {savedReports.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b">
        {(
          [
            { id: 'search', label: 'Search', icon: Search },
            { id: 'new-packages', label: 'New in window', icon: TrendingUp },
            { id: 'drift', label: 'Package drift', icon: GitBranch },
          ] as { id: ActiveView; label: string; icon: React.ComponentType<{ className?: string }> }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeView === tab.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search view */}
      {activeView === 'search' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Package name typeahead */}
              <div className="space-y-1 min-w-[220px]">
                <Label className="text-xs">Package name</Label>
                <Popover open={namePopoverOpen && nameInput.length >= 2} onOpenChange={setNamePopoverOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="e.g. openssl"
                        className="pl-8 h-8 text-sm"
                        value={nameInput}
                        onChange={(e) => {
                          setNameInput(e.target.value)
                          setNamePopoverOpen(e.target.value.length >= 2)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setNameParam(nameInput)
                            setNamePopoverOpen(false)
                            setPage('1')
                          }
                        }}
                      />
                      {nameInput && (
                        <button
                          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setNameInput('')
                            setNameParam('')
                            setNamePopoverOpen(false)
                          }}
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[300px]" align="start">
                    <Command>
                      <CommandList>
                        <CommandEmpty>No packages found.</CommandEmpty>
                        <CommandGroup>
                          {suggestions.map((s) => (
                            <CommandItem
                              key={s.name}
                              value={s.name}
                              onSelect={(v) => {
                                setNameInput(v)
                                setNameParam(v)
                                setNamePopoverOpen(false)
                                setPage('1')
                              }}
                            >
                              <span className="font-mono text-sm">{s.name}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {s.hostCount} host{s.hostCount === 1 ? '' : 's'}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Version mode */}
              <div className="space-y-1">
                <Label className="text-xs">Version filter</Label>
                <Select
                  value={versionMode}
                  onValueChange={(v) => { setVersionMode(v as VersionMode); setPage('1') }}
                >
                  <SelectTrigger className="h-8 text-sm w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(VERSION_MODE_LABELS) as [VersionMode, string][]).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {versionMode === 'exact' && (
                <div className="space-y-1">
                  <Label className="text-xs">Version</Label>
                  <Input
                    className="h-8 text-sm w-32"
                    placeholder="e.g. 1.2.3"
                    value={versionExact}
                    onChange={(e) => { setVersionExact(e.target.value); setPage('1') }}
                  />
                </div>
              )}
              {versionMode === 'prefix' && (
                <div className="space-y-1">
                  <Label className="text-xs">Version starts with</Label>
                  <Input
                    className="h-8 text-sm w-32"
                    placeholder="e.g. 1.2."
                    value={versionPrefix}
                    onChange={(e) => { setVersionPrefix(e.target.value); setPage('1') }}
                  />
                </div>
              )}
              {versionMode === 'between' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">From version</Label>
                    <Input
                      className="h-8 text-sm w-28"
                      placeholder="e.g. 1.1.1"
                      value={versionLow}
                      onChange={(e) => { setVersionLow(e.target.value); setPage('1') }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To version</Label>
                    <Input
                      className="h-8 text-sm w-28"
                      placeholder="e.g. 3.0.0"
                      value={versionHigh}
                      onChange={(e) => { setVersionHigh(e.target.value); setPage('1') }}
                    />
                  </div>
                </>
              )}

              {/* Source filter */}
              <div className="space-y-1">
                <Label className="text-xs">Source</Label>
                <Select
                  value={sourceFilter}
                  onValueChange={(v) => { setSourceFilter(v); setPage('1') }}
                >
                  <SelectTrigger className="h-8 text-sm w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {versionMode === 'between' && (
              <p className="text-xs text-muted-foreground">
                Versions compare using semver where possible, otherwise natural sort. For Debian/RPM epoch suffixes (e.g.{' '}
                <code className="font-mono">2:1.4.5-1ubuntu1</code>) use <strong>Starts with</strong> if results look off.
              </p>
            )}
          </div>

          {/* Summary bar */}
          {report && (
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{report.total.toLocaleString()}</span> result{report.total === 1 ? '' : 's'}
              </span>
              <span>
                <span className="font-medium text-foreground">{report.uniquePackages.toLocaleString()}</span> unique packages
              </span>
              <span>
                <span className="font-medium text-foreground">{report.hostsWithData.toLocaleString()}</span> hosts with data
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSaveDialogOpen(true)}
                  disabled={!filters.name && versionMode === 'any' && !sourceFilter}
                >
                  <Save className="size-3.5 mr-1.5" />
                  Save filters
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
                  <Download className="size-3.5 mr-1.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('pdf')}>
                  <Download className="size-3.5 mr-1.5" />
                  PDF
                </Button>
              </div>
            </div>
          )}

          {/* Results table */}
          {reportLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : report && report.rows.length > 0 ? (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Package</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Hosts</TableHead>
                      <TableHead>Sources</TableHead>
                      <TableHead>Hosts preview</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row) => {
                      const key = `${row.name}\0${row.version}`
                      const expanded = expandedRows.has(key)
                      return (
                        <Fragment key={key}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => toggleRowExpanded(key)}
                          >
                            <TableCell>
                              {expanded ? (
                                <ChevronDown className="size-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="size-3.5 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm font-medium">{row.name}</TableCell>
                            <TableCell className="font-mono text-sm">{row.version}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{row.hostCount}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1 flex-wrap">
                                {row.sources.map((s) => (
                                  <Badge key={s} variant="outline" className="text-xs">
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.hostNames.slice(0, 3).join(', ')}
                              {row.hostNames.length > 3 && ` +${row.hostNames.length - 3} more`}
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/30 px-8 py-3">
                                <p className="text-xs font-medium text-muted-foreground mb-2">
                                  All hosts with {row.name} {row.version}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {row.hostNames.map((name, i) => (
                                    <Badge key={i} variant="outline" className="text-xs font-normal">
                                      {name}
                                    </Badge>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => setPage(String(currentPage - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage(String(currentPage + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : report ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <Package className="size-8 mx-auto mb-3 opacity-30" />
              No packages match your filters.
            </div>
          ) : null}
        </div>
      )}

      {/* New-in-window view */}
      {activeView === 'new-packages' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Show packages first seen in the last</Label>
            <Select
              value={String(newWindowDays)}
              onValueChange={(v) => setNewWindowDays(Number(v) as 7 | 30)}
            >
              <SelectTrigger className="h-8 w-24 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Useful for spotting newly installed packages across your estate.
            </p>
          </div>

          {newLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : newPackages.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No new packages in the last {newWindowDays} days.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Package</TableHead>
                    <TableHead>Hosts</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>First seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {newPackages.map((pkg) => (
                    <TableRow key={pkg.name}>
                      <TableCell className="font-mono text-sm font-medium">{pkg.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{pkg.hostCount}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {pkg.sources.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(pkg.firstSeenAt), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Package drift view */}
      {activeView === 'drift' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hosts in the same group running different versions of the same package. Useful for detecting configuration drift.
          </p>
          {driftLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : driftRows.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <GitBranch className="size-8 mx-auto mb-3 opacity-30" />
              No package drift detected across host groups.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Package</TableHead>
                    <TableHead>Host group</TableHead>
                    <TableHead>Versions found</TableHead>
                    <TableHead>Versions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driftRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm font-medium">{row.packageName}</TableCell>
                      <TableCell className="text-sm">{row.groupName}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">{row.versionCount}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {row.versions.map((v) => (
                            <Badge key={v} variant="outline" className="text-xs font-mono">
                              {v}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Save report dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save report filters</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="save-name">Report name</Label>
              <Input
                id="save-name"
                placeholder="e.g. OpenSSL < 3.0 exposure"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!saveName.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Saved reports dialog */}
      <Dialog open={savedReportsOpen} onOpenChange={setSavedReportsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Saved reports</DialogTitle>
          </DialogHeader>
          {savedReports.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No saved reports yet. Use &ldquo;Save filters&rdquo; after setting up a search.
            </p>
          ) : (
            <div className="space-y-2 py-2 max-h-80 overflow-y-auto">
              {savedReports.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-md border hover:bg-muted/50"
                >
                  <button
                    className="flex-1 text-left text-sm font-medium text-foreground"
                    onClick={() => loadSavedReport(r.filters as SoftwareReportFilters)}
                  >
                    {r.name}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteSavedMutation.mutate(r.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavedReportsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
