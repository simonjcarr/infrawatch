'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  getChecks,
  createCheck,
  updateCheck,
  deleteCheck,
  getCheckResults,
} from '@/lib/actions/checks'
import type { CheckWithLatestResult, CheckResultRow } from '@/lib/actions/checks'
import type { CheckType } from '@/lib/db/schema'

interface Props {
  orgId: string
  hostId: string
}

function CheckStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) {
    return (
      <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
        Never run
      </Badge>
    )
  }
  switch (status) {
    case 'pass':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          <CheckCircle className="size-3 mr-1" />
          Pass
        </Badge>
      )
    case 'fail':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          <XCircle className="size-3 mr-1" />
          Fail
        </Badge>
      )
    case 'error':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          <AlertTriangle className="size-3 mr-1" />
          Error
        </Badge>
      )
    default:
      return (
        <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
          {status}
        </Badge>
      )
  }
}

function CheckTypeBadge({ type }: { type: string }) {
  switch (type) {
    case 'port':
      return (
        <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">
          Port
        </Badge>
      )
    case 'process':
      return (
        <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50">
          Process
        </Badge>
      )
    case 'http':
      return (
        <Badge variant="outline" className="text-teal-700 border-teal-300 bg-teal-50">
          HTTP
        </Badge>
      )
    default:
      return <Badge variant="outline">{type}</Badge>
  }
}

function ResultHistory({ orgId, checkId }: { orgId: string; checkId: string }) {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ['check-results', orgId, checkId],
    queryFn: () => getCheckResults(orgId, checkId),
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-2">Loading results...</p>
  }

  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">No results yet.</p>
  }

  return (
    <div className="mt-3 space-y-1">
      {results.map((r: CheckResultRow) => (
        <div
          key={r.id}
          className="flex items-start gap-3 text-sm py-1.5 border-b last:border-0"
        >
          <div className="shrink-0 mt-0.5">
            <CheckStatusBadge status={r.status} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-foreground truncate">{r.output ?? '—'}</p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(r.ranAt), { addSuffix: true })}
              {r.durationMs != null && ` · ${r.durationMs}ms`}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function AddCheckDialog({
  open,
  onOpenChange,
  orgId,
  hostId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  hostId: string
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [checkType, setCheckType] = useState<CheckType>('port')
  const [intervalSeconds, setIntervalSeconds] = useState(60)
  const [error, setError] = useState('')

  // Port config
  const [portHost, setPortHost] = useState('')
  const [portPort, setPortPort] = useState('')

  // Process config
  const [processName, setProcessName] = useState('')

  // HTTP config
  const [httpUrl, setHttpUrl] = useState('')
  const [httpStatus, setHttpStatus] = useState('200')

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      let config: unknown
      if (checkType === 'port') {
        config = { host: portHost, port: parseInt(portPort, 10) }
      } else if (checkType === 'process') {
        config = { process_name: processName }
      } else {
        config = { url: httpUrl, expected_status: parseInt(httpStatus, 10) }
      }
      return createCheck(orgId, { hostId, name, checkType, config, intervalSeconds })
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['checks', orgId, hostId] })
      onOpenChange(false)
      resetForm()
    },
  })

  function resetForm() {
    setName('')
    setCheckType('port')
    setIntervalSeconds(60)
    setPortHost('')
    setPortPort('')
    setProcessName('')
    setHttpUrl('')
    setHttpStatus('200')
    setError('')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Check</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="check-name">Name</Label>
            <Input
              id="check-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. PostgreSQL port"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={checkType} onValueChange={(v) => setCheckType(v as CheckType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="port">Port — TCP connectivity</SelectItem>
                <SelectItem value="process">Process — running process</SelectItem>
                <SelectItem value="http">HTTP — health endpoint</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {checkType === 'port' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="port-host">Host</Label>
                <Input
                  id="port-host"
                  value={portHost}
                  onChange={(e) => setPortHost(e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="port-port">Port</Label>
                <Input
                  id="port-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={portPort}
                  onChange={(e) => setPortPort(e.target.value)}
                  placeholder="5432"
                />
              </div>
            </div>
          )}

          {checkType === 'process' && (
            <div className="space-y-1.5">
              <Label htmlFor="process-name">Process name</Label>
              <Input
                id="process-name"
                value={processName}
                onChange={(e) => setProcessName(e.target.value)}
                placeholder="nginx"
              />
            </div>
          )}

          {checkType === 'http' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="http-url">URL</Label>
                <Input
                  id="http-url"
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                  placeholder="http://localhost:8080/health"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="http-status">Expected status code</Label>
                <Input
                  id="http-status"
                  type="number"
                  value={httpStatus}
                  onChange={(e) => setHttpStatus(e.target.value)}
                  placeholder="200"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="interval">Interval (seconds)</Label>
            <Input
              id="interval"
              type="number"
              min={10}
              max={3600}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(parseInt(e.target.value, 10))}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutate()} disabled={isPending || !name}>
            {isPending ? 'Adding...' : 'Add check'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CheckRow({
  check,
  orgId,
  hostId,
}: {
  check: CheckWithLatestResult
  orgId: string
  hostId: string
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const { mutate: toggleEnabled } = useMutation({
    mutationFn: (enabled: boolean) => updateCheck(orgId, check.id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checks', orgId, hostId] }),
  })

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: () => deleteCheck(orgId, check.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checks', orgId, hostId] }),
  })

  return (
    <div className="border rounded-lg">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{check.name}</span>
            <CheckTypeBadge type={check.checkType} />
            <CheckStatusBadge status={check.latestResult?.status} />
          </div>
          {check.latestResult && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last run {formatDistanceToNow(new Date(check.latestResult.ranAt), { addSuffix: true })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={check.enabled}
            onCheckedChange={(v) => toggleEnabled(v)}
            aria-label="Enabled"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-red-600"
            onClick={() => remove()}
            disabled={isDeleting}
            aria-label="Delete check"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t pt-3">
          <ResultHistory orgId={orgId} checkId={check.id} />
        </div>
      )}
    </div>
  )
}

export function ChecksTab({ orgId, hostId }: Props) {
  const [addOpen, setAddOpen] = useState(false)

  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['checks', orgId, hostId],
    queryFn: () => getChecks(orgId, hostId),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {checks.length === 0 ? 'No checks configured' : `${checks.length} check${checks.length === 1 ? '' : 's'}`}
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4 mr-1" />
          Add check
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : checks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldCheck className="size-10 text-muted-foreground mb-3" />
            <p className="font-medium text-foreground">No checks configured</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Add port, process, or HTTP checks to monitor services on this host.
            </p>
            <Button className="mt-4" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-1" />
              Add first check
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} orgId={orgId} hostId={hostId} />
          ))}
        </div>
      )}

      <AddCheckDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        orgId={orgId}
        hostId={hostId}
      />
    </div>
  )
}
