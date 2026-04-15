'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { formatDistanceToNow } from 'date-fns'
import {
  Search,
  Download,
  Save,
  Trash2,
  Loader2,
  Package,
  TrendingUp,
  GitBranch,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  searchPackageNames,
  getPackageDetails,
  getPackageVersions,
  getNewPackages,
  getPackageDrift,
  listSavedReports,
  saveSoftwareReport,
  deleteSavedReport,
} from '@/lib/actions/software-inventory'
import type { SoftwareReportFilters, VersionMode } from '@/lib/actions/software-inventory'
import { compareVersions } from '@/lib/version-compare'
import type { HostGroup } from '@/lib/db/schema'

interface Props {
  orgId: string
  orgName: string
  hostGroups: Pick<HostGroup, 'id' | 'name'>[]
}

type ActiveView = 'search' | 'new-packages' | 'drift'

type SortKey = 'host' | 'os' | 'version' | 'source' | 'architecture' | 'firstSeen' | 'lastSeen'
type SortDir = 'asc' | 'desc'

const VERSION_MODE_LABELS: Record<VersionMode, string> = {
  any: 'Any version',
  exact: 'Exact',
  prefix: 'Starts with',
  between: 'Between',
}

const ALL_OS = '__all__'

const OS_OPTIONS = [
  { value: ALL_OS, label: 'All OS types' },
  { value: 'linux', label: 'Linux' },
  { value: 'darwin', label: 'macOS' },
  { value: 'windows', label: 'Windows' },
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
  const [osFamilyFilter, setOsFamilyFilter] = useQueryState('of', { defaultValue: '' })
  const [page, setPage] = useQueryState('p', { defaultValue: '1' })

  // Local state
  const [nameInput, setNameInput] = useState(nameParam)
  const [namePopoverOpen, setNamePopoverOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [savedReportsOpen, setSavedReportsOpen] = useState(false)
  const [newWindowDays, setNewWindowDays] = useState<7 | 30>(7)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)

  // Sort state for the unified results table
  const [sortKey, setSortKey] = useState<SortKey>('version')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Version and date columns feel more natural starting desc; others asc.
      setSortDir(key === 'version' || key === 'lastSeen' || key === 'firstSeen' ? 'desc' : 'asc')
    }
  }

  const filters: SoftwareReportFilters = {
    name: nameParam || undefined,
    versionMode: versionMode as VersionMode,
    versionExact: versionExact || undefined,
    versionPrefix: versionPrefix || undefined,
    versionLow: versionLow || undefined,
    versionHigh: versionHigh || undefined,
    osFamily: osFamilyFilter || undefined,
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

  // Package details (shown when a package is selected)
  const { data: packageDetails, isLoading: detailsLoading } = useQuery({
    queryKey: ['package-details', orgId, nameParam, osFamilyFilter],
    queryFn: () => getPackageDetails(orgId, nameParam, osFamilyFilter || undefined),
    enabled: activeView === 'search' && !!nameParam,
    staleTime: 30_000,
  })

  // Available versions for the exact-version dropdown
  const { data: availableVersions = [] } = useQuery({
    queryKey: ['package-versions', orgId, nameParam],
    queryFn: () => getPackageVersions(orgId, nameParam),
    enabled: activeView === 'search' && !!nameParam && versionMode === 'exact',
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
    setOsFamilyFilter(f.osFamily ?? '')
    setPage('1')
  }

  function loadSavedReport(filters: SoftwareReportFilters) {
    applyFilters(filters)
    setSavedReportsOpen(false)
    setActiveView('search')
  }

  async function handleExport(format: 'csv' | 'pdf') {
    const params = new URLSearchParams()
    params.set('format', format)
    if (filters.name) params.set('name', filters.name)
    if (filters.versionMode && filters.versionMode !== 'any') params.set('vm', filters.versionMode)
    if (filters.versionExact) params.set('ve', filters.versionExact)
    if (filters.versionPrefix) params.set('vp', filters.versionPrefix)
    if (filters.versionLow) params.set('vl', filters.versionLow)
    if (filters.versionHigh) params.set('vh', filters.versionHigh)
    if (filters.osFamily) params.set('of', filters.osFamily)

    setExportLoading(true)
    try {
      const res = await fetch(`/api/reports/software/export?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setExportError((data as { error?: string }).error ?? 'Export failed. Please try again.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="(.+?)"/)
      a.download = match?.[1] ?? `software-report.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('Export failed due to a network error. Please try again.')
    } finally {
      setExportLoading(false)
    }
  }

// Client-side version filtering + flattening + sorting of package detail rows
  const displayedRows = useMemo(() => {
    const groups = packageDetails?.versionGroups ?? []

    const filteredGroups = (() => {
      if (versionMode === 'exact' && versionExact) {
        return groups.filter((g) => g.version === versionExact)
      }
      if (versionMode === 'prefix' && versionPrefix) {
        return groups.filter((g) => g.version.startsWith(versionPrefix))
      }
      if (versionMode === 'between' && versionLow && versionHigh) {
        return groups.filter(
          (g) =>
            compareVersions(g.version, versionLow) >= 0 &&
            compareVersions(g.version, versionHigh) <= 0,
        )
      }
      return groups
    })()

    const rows = filteredGroups.flatMap((g) => g.hosts)

    const dirMul = sortDir === 'asc' ? 1 : -1
    const cmpStr = (a: string, b: string) =>
      a < b ? -1 * dirMul : a > b ? 1 * dirMul : 0

    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'host':
          return cmpStr(
            (a.displayName ?? a.hostname).toLowerCase(),
            (b.displayName ?? b.hostname).toLowerCase(),
          )
        case 'os':
          return cmpStr(
            (a.osVersion ?? a.os ?? '').toLowerCase(),
            (b.osVersion ?? b.os ?? '').toLowerCase(),
          )
        case 'version':
          return compareVersions(a.version, b.version) * dirMul
        case 'source':
          return cmpStr(a.source.toLowerCase(), b.source.toLowerCase())
        case 'architecture':
          return cmpStr(
            (a.architecture ?? '').toLowerCase(),
            (b.architecture ?? '').toLowerCase(),
          )
        case 'firstSeen':
          return (
            (new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime()) * dirMul
          )
        case 'lastSeen':
          return (
            (new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()) * dirMul
          )
      }
    })
  }, [
    packageDetails,
    versionMode,
    versionExact,
    versionPrefix,
    versionLow,
    versionHigh,
    sortKey,
    sortDir,
  ])

  // Chart data derived from the filtered/sorted rows
  const osChartData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of displayedRows) {
      const label = row.os ?? 'Unknown'
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [displayedRows])

  const versionChartData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of displayedRows) {
      counts.set(row.version, (counts.get(row.version) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
  }, [displayedRows])

  const CHART_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#14b8a6', '#f97316', '#a855f7', '#84cc16']

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
              {/* Package name combobox */}
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
                          if (!e.target.value) {
                            setNameParam('')
                          }
                          setNamePopoverOpen(e.target.value.length >= 2)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setNamePopoverOpen(false)
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
                  <PopoverContent
                    className="p-0 w-[300px]"
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
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
                                setVersionExact('')
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
                  onValueChange={(v) => { setVersionMode(v as VersionMode); setVersionExact(''); setPage('1') }}
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
                  {nameParam && availableVersions.length > 0 ? (
                    <Select
                      value={versionExact || '__any__'}
                      onValueChange={(v) => { setVersionExact(v === '__any__' ? '' : v); setPage('1') }}
                    >
                      <SelectTrigger className="h-8 text-sm w-44">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">Any exact version</SelectItem>
                        {availableVersions.map((v) => (
                          <SelectItem key={v} value={v}>
                            <span className="font-mono">{v}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-8 text-sm w-36"
                      placeholder="e.g. 1.2.3"
                      value={versionExact}
                      onChange={(e) => { setVersionExact(e.target.value); setPage('1') }}
                    />
                  )}
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

              {/* OS type filter */}
              <div className="space-y-1">
                <Label className="text-xs">OS type</Label>
                <Select
                  value={osFamilyFilter || ALL_OS}
                  onValueChange={(v) => {
                    setOsFamilyFilter(v === ALL_OS ? '' : v)
                    setPage('1')
                  }}
                >
                  <SelectTrigger className="h-8 text-sm w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OS_OPTIONS.map((o) => (
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

          {/* Package details (shown when a package is selected) */}
          {nameParam ? (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {packageDetails && (() => {
                  const uniqueHosts = new Set(displayedRows.map((r) => r.hostId)).size
                  const uniqueVersions = new Set(displayedRows.map((r) => r.version)).size
                  return (
                    <>
                      <span>
                        <span className="font-medium text-foreground">{uniqueHosts.toLocaleString()}</span>{' '}
                        host{uniqueHosts === 1 ? '' : 's'} with this package
                      </span>
                      <span>
                        <span className="font-medium text-foreground">{uniqueVersions}</span>{' '}
                        version{uniqueVersions === 1 ? '' : 's'}
                      </span>
                    </>
                  )
                })()}
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSaveDialogOpen(true)}
                    disabled={!filters.name}
                  >
                    <Save className="size-3.5 mr-1.5" />
                    Save filters
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={exportLoading}>
                    {exportLoading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Download className="size-3.5 mr-1.5" />}
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExport('pdf')} disabled={exportLoading}>
                    {exportLoading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Download className="size-3.5 mr-1.5" />}
                    PDF
                  </Button>
                </div>
              </div>

              {/* Distribution charts — shown when results are available */}
              {!detailsLoading && displayedRows.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {/* text-muted-foreground sets `color` on the div; SVG currentColor inherits it */}
                  <div className="rounded-md border p-4 text-muted-foreground">
                    <p className="text-xs font-medium mb-3">OS distribution</p>
                    <ResponsiveContainer width="100%" height={Math.max(80, osChartData.length * 36)}>
                      <BarChart
                        data={osChartData}
                        layout="vertical"
                        margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={80}
                          tick={{ fontSize: 11, fill: 'currentColor' }}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: 12,
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            color: 'hsl(var(--popover-foreground))',
                          }}
                        />
                        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                          {osChartData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-md border p-4 text-muted-foreground">
                    <p className="text-xs font-medium mb-3">Version distribution</p>
                    <ResponsiveContainer width="100%" height={Math.max(80, versionChartData.length * 36)}>
                      <BarChart
                        data={versionChartData}
                        layout="vertical"
                        margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="version"
                          width={160}
                          tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'currentColor' }}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: 12,
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            color: 'hsl(var(--popover-foreground))',
                          }}
                        />
                        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                          {versionChartData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {detailsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : displayedRows.length > 0 ? (
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTh label="Host" sortKey="host" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <SortableTh label="OS" sortKey="os" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <SortableTh label="Version" sortKey="version" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <SortableTh label="Source" sortKey="source" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <SortableTh label="Architecture" sortKey="architecture" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <SortableTh label="First seen" sortKey="firstSeen" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <SortableTh label="Last seen" sortKey="lastSeen" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedRows.map((row) => (
                        <TableRow key={`${row.hostId}:${row.version}:${row.architecture ?? ''}`}>
                          <TableCell className="font-medium text-sm">
                            <Link
                              href={`/hosts/${row.hostId}`}
                              className="text-primary hover:underline"
                            >
                              {row.displayName ?? row.hostname}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.osVersion ?? row.os ?? '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.version}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {row.source}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.architecture ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(row.firstSeenAt), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(row.lastSeenAt), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : packageDetails ? (
                <div className="text-center py-16 text-sm text-muted-foreground">
                  <Package className="size-8 mx-auto mb-3 opacity-30" />
                  No hosts found matching the current filters.
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <Package className="size-8 mx-auto mb-3 opacity-30" />
              Start typing a package name above to search and select a package.
            </div>
          )}
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

      {/* Export error dialog */}
      <Dialog open={!!exportError} onOpenChange={() => setExportError(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export failed</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{exportError}</p>
          <DialogFooter>
            <Button onClick={() => setExportError(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function SortableTh({
  label,
  sortKey: key,
  currentKey,
  dir,
  onClick,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  dir: SortDir
  onClick: (key: SortKey) => void
}) {
  const active = currentKey === key
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onClick(key)}
        className={`inline-flex items-center gap-1 -mx-2 px-2 py-1 rounded hover:bg-muted/60 ${
          active ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  )
}
