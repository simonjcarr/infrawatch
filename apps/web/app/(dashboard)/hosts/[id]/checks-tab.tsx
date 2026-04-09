'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  Loader2,
  Search,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  getChecksWithHistory,
  createCheck,
  updateCheck,
  deleteCheck,
  deleteCheckHistory,
} from '@/lib/actions/checks'
import type { CheckWithHistory } from '@/lib/actions/checks'
import type {
  CheckResultRow,
  CheckType,
  PortCheckConfig,
  ProcessCheckConfig,
  HttpCheckConfig,
  CertificateCheckConfig,
  CertFileCheckConfig,
  AgentQueryStatus,
  PortInfoResult,
  ServiceInfoResult,
} from '@/lib/db/schema'

type AgentQueryPollResponse = {
  status: AgentQueryStatus
  result?: { ports?: PortInfoResult[]; services?: ServiceInfoResult[] }
  error?: string
}

interface Props {
  orgId: string
  hostId: string
}

const STATUS_COLOUR: Record<string, string> = {
  pass: '#22c55e',
  fail: '#ef4444',
  error: '#f59e0b',
}

function formatCheckOutput(checkType: string, output: string): string {
  if (checkType === 'service_account') {
    try {
      const r = JSON.parse(output) as { accounts?: { username: string }[]; error?: string }
      if (r.error) return r.error
      return `${r.accounts?.length ?? 0} accounts discovered`
    } catch { return output }
  }
  if (checkType === 'ssh_key_scan') {
    try {
      const r = JSON.parse(output) as { keys?: { key_type: string }[]; error?: string }
      if (r.error) return r.error
      return `${r.keys?.length ?? 0} SSH keys discovered`
    } catch { return output }
  }
  if (checkType !== 'certificate' && checkType !== 'cert_file') return output
  try {
    const r = JSON.parse(output) as {
      common_name?: string
      subject?: string
      not_after?: string
      error?: string
    }
    if (r.error) return r.error
    const cn = r.common_name || r.subject || '—'
    const expiry = r.not_after ? new Date(r.not_after) : null
    const daysLeft = expiry
      ? Math.floor((expiry.getTime() - Date.now()) / 86_400_000)
      : null
    const expiryStr =
      daysLeft === null
        ? ''
        : daysLeft < 0
        ? ` · Expired ${Math.abs(daysLeft)}d ago`
        : ` · Expires in ${daysLeft}d`
    return `${cn}${expiryStr}`
  } catch {
    return output
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
    case 'certificate':
      return (
        <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
          Certificate
        </Badge>
      )
    case 'cert_file':
      return (
        <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
          Cert File
        </Badge>
      )
    case 'service_account':
      return (
        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
          Svc Accounts
        </Badge>
      )
    case 'ssh_key_scan':
      return (
        <Badge variant="outline" className="text-indigo-700 border-indigo-300 bg-indigo-50">
          SSH Keys
        </Badge>
      )
    default:
      return <Badge variant="outline">{type}</Badge>
  }
}

function StatusDots({ results }: { results: CheckResultRow[] }) {
  const last5 = [...results].slice(0, 5).reverse()
  const empty = Math.max(0, 5 - last5.length)

  return (
    <div className="flex items-center gap-1" aria-label="Last 5 check results">
      {Array.from({ length: empty }).map((_, i) => (
        <span key={`e-${i}`} className="size-2.5 rounded-full bg-gray-200 inline-block" />
      ))}
      {last5.map((r) => (
        <span
          key={r.id}
          title={`${r.status} · ${formatDistanceToNow(new Date(r.ranAt), { addSuffix: true })}`}
          className="size-2.5 rounded-full inline-block"
          style={{ backgroundColor: STATUS_COLOUR[r.status] ?? '#9ca3af' }}
        />
      ))}
    </div>
  )
}

function StatusWeather({ results }: { results: CheckResultRow[] }) {
  const last5 = results.slice(0, 5)

  if (last5.length === 0) {
    return (
      <span title="Never run">
        <Cloud className="size-4 text-muted-foreground" aria-label="No data" />
      </span>
    )
  }

  const pass = last5.filter((r) => r.status === 'pass').length
  const fail = last5.filter((r) => r.status === 'fail').length
  const error = last5.filter((r) => r.status === 'error').length
  const total = last5.length
  const parts: string[] = []
  if (pass > 0) parts.push(`${pass} pass`)
  if (fail > 0) parts.push(`${fail} fail`)
  if (error > 0) parts.push(`${error} error`)
  const label = parts.join(', ')

  if (pass === total) {
    return <span title={label}><Sun className="size-4 text-amber-400" aria-label="All passing" /></span>
  }
  if (pass >= Math.ceil(total * 0.8)) {
    return <span title={label}><CloudSun className="size-4 text-amber-400" aria-label="Mostly passing" /></span>
  }
  if (pass >= Math.ceil(total * 0.4)) {
    return <span title={label}><CloudRain className="size-4 text-blue-400" aria-label="Partially failing" /></span>
  }
  return <span title={label}><CloudLightning className="size-4 text-red-500" aria-label="Mostly failing" /></span>
}

function CheckHistoryChart({ results, checkType }: { results: CheckResultRow[]; checkType: string }) {
  const data = [...results]
    .reverse()
    .map((r) => ({
      id: r.id,
      time: new Date(r.ranAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      duration: Math.max(1, r.durationMs ?? 1),
      status: r.status,
      output: r.output ? formatCheckOutput(checkType, r.output) : r.output,
    }))

  return (
    <ResponsiveContainer width="100%" height={72}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap="10%">
        <XAxis
          dataKey="time"
          tick={{ fontSize: 9, fill: '#9ca3af' }}
          interval="preserveStartEnd"
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'transparent' }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null
            const d = payload[0].payload as (typeof data)[number]
            return (
              <div className="text-xs bg-white border rounded px-2 py-1.5 shadow-sm space-y-0.5">
                <p
                  className="font-medium"
                  style={{ color: STATUS_COLOUR[d.status] ?? '#6b7280' }}
                >
                  {d.status}
                </p>
                {d.output && <p className="text-muted-foreground truncate max-w-48">{d.output}</p>}
                <p className="text-muted-foreground">{d.time}</p>
                <p className="text-muted-foreground">
                  Response time:{' '}
                  <span className="text-foreground font-medium">{d.duration}ms</span>
                </p>
              </div>
            )
          }}
        />
        <Bar dataKey="duration" minPointSize={6} radius={[2, 2, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.id}
              fill={STATUS_COLOUR[entry.status] ?? '#9ca3af'}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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

  const [portHost, setPortHost] = useState('')
  const [portPort, setPortPort] = useState('')
  const [processName, setProcessName] = useState('')
  const [httpUrl, setHttpUrl] = useState('')
  const [httpStatus, setHttpStatus] = useState('200')
  const [certHost, setCertHost] = useState('')
  const [certPort, setCertPort] = useState('443')
  const [certServerName, setCertServerName] = useState('')
  const [certFilePath, setCertFilePath] = useState('')
  const [certFileFormat, setCertFileFormat] = useState<'pem' | 'pkcs12' | 'jks'>('pem')
  const [certFilePassword, setCertFilePassword] = useState('')
  const [certFileAlias, setCertFileAlias] = useState('')

  // Ad-hoc agent query ("Query server" button) state
  const [queryId, setQueryId] = useState<string | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)

  const { data: queryData } = useQuery<AgentQueryPollResponse>({
    queryKey: ['agent-query', hostId, queryId],
    queryFn: async () => {
      const res = await fetch(`/api/hosts/${hostId}/queries/${queryId}`)
      if (!res.ok) throw new Error('Failed to poll query')
      return res.json()
    },
    enabled: queryId !== null,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'complete' || s === 'error' ? false : 1_000
    },
  })

  async function handleQuery(queryType: 'list_ports' | 'list_services') {
    setQueryId(null)
    setQueryError(null)
    try {
      const res = await fetch(`/api/hosts/${hostId}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryType }),
      })
      const data = await res.json()
      if (!res.ok) {
        setQueryError(data.error ?? 'Failed to start query')
        return
      }
      setQueryId(data.id)
    } catch {
      setQueryError('Failed to start query')
    }
  }

  const isQuerying = queryId !== null && queryData?.status === 'pending'
  const queryErrored = queryData?.status === 'error' || queryError !== null
  const queryErrorMessage = queryError ?? queryData?.error ?? null

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      let config: unknown
      if (checkType === 'port') {
        config = { host: portHost, port: parseInt(portPort, 10) }
      } else if (checkType === 'process') {
        config = { process_name: processName }
      } else if (checkType === 'certificate') {
        const certConfig: CertificateCheckConfig = { host: certHost, port: parseInt(certPort, 10) || 443 }
        if (certServerName) certConfig.serverName = certServerName
        config = certConfig
      } else if (checkType === 'cert_file') {
        const certFileConfig: CertFileCheckConfig = { filePath: certFilePath, format: certFileFormat }
        if (certFilePassword) certFileConfig.password = certFilePassword
        if (certFileAlias) certFileConfig.alias = certFileAlias
        config = certFileConfig
      } else if (checkType === 'service_account') {
        config = {}
      } else if (checkType === 'ssh_key_scan') {
        config = {}
      } else {
        config = { url: httpUrl, expected_status: parseInt(httpStatus, 10) || 200 }
      }
      return createCheck(orgId, { hostId, name, checkType, config, intervalSeconds })
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['checks-history', orgId, hostId] })
      onOpenChange(false)
      resetForm()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Something went wrong')
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
    setCertHost('')
    setCertPort('443')
    setCertServerName('')
    setCertFilePath('')
    setCertFileFormat('pem')
    setCertFilePassword('')
    setCertFileAlias('')
    setError('')
    setQueryId(null)
    setQueryError(null)
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
                <SelectItem value="certificate">Certificate — TLS certificate</SelectItem>
                <SelectItem value="cert_file">Certificate — File on disk</SelectItem>
                <SelectItem value="service_account">Service Accounts — discover system users</SelectItem>
                <SelectItem value="ssh_key_scan">SSH Key Scan — discover SSH keys</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {checkType === 'port' && (
            <div className="space-y-2">
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

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuery('list_ports')}
                  disabled={isQuerying}
                >
                  {isQuerying ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      Querying server…
                    </>
                  ) : (
                    <>
                      <Search className="size-3.5 mr-1.5" />
                      Query server
                    </>
                  )}
                </Button>
                {queryErrored && queryErrorMessage && (
                  <p className="text-xs text-red-600">{queryErrorMessage}</p>
                )}
              </div>

              {queryData?.status === 'complete' && queryData.result?.ports && (
                <div className="rounded-md border bg-muted/50 p-2 space-y-0.5 max-h-48 overflow-y-auto">
                  <p className="text-xs text-muted-foreground font-medium px-1 pb-1">
                    {queryData.result.ports.length === 0
                      ? 'No listening ports found'
                      : 'Select a listening port'}
                  </p>
                  {queryData.result.ports.map((p, i) => (
                    <button
                      key={`${p.port}-${p.process ?? ''}-${i}`}
                      type="button"
                      onClick={() => {
                        setPortPort(String(p.port))
                        if (!portHost) setPortHost('localhost')
                        setQueryId(null)
                      }}
                      className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center justify-between text-foreground"
                    >
                      <span className="font-mono">{p.protocol}:{p.port}</span>
                      {p.process && (
                        <span className="text-xs text-muted-foreground">{p.process}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {checkType === 'process' && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="process-name">Process name</Label>
                <Input
                  id="process-name"
                  value={processName}
                  onChange={(e) => setProcessName(e.target.value)}
                  placeholder="nginx"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuery('list_services')}
                  disabled={isQuerying}
                >
                  {isQuerying ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      Querying server…
                    </>
                  ) : (
                    <>
                      <Search className="size-3.5 mr-1.5" />
                      Query server
                    </>
                  )}
                </Button>
                {queryErrored && queryErrorMessage && (
                  <p className="text-xs text-red-600">{queryErrorMessage}</p>
                )}
              </div>

              {queryData?.status === 'complete' && queryData.result?.services && (
                <div className="rounded-md border bg-muted/50 p-2 space-y-0.5 max-h-48 overflow-y-auto">
                  <p className="text-xs text-muted-foreground font-medium px-1 pb-1">
                    {queryData.result.services.length === 0
                      ? 'No running services found'
                      : 'Select a running service'}
                  </p>
                  {queryData.result.services.map((s, i) => (
                    <button
                      key={`${s.name}-${i}`}
                      type="button"
                      onClick={() => {
                        setProcessName(s.name.replace(/\.service$/, ''))
                        setQueryId(null)
                      }}
                      className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent text-foreground"
                    >
                      <span className="font-mono">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
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

          {checkType === 'certificate' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cert-host">Host</Label>
                  <Input
                    id="cert-host"
                    value={certHost}
                    onChange={(e) => setCertHost(e.target.value)}
                    placeholder="example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cert-port">Port</Label>
                  <Input
                    id="cert-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={certPort}
                    onChange={(e) => setCertPort(e.target.value)}
                    placeholder="443"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-sni">
                  Server name (SNI){' '}
                  <span className="text-muted-foreground font-normal">— optional</span>
                </Label>
                <Input
                  id="cert-sni"
                  value={certServerName}
                  onChange={(e) => setCertServerName(e.target.value)}
                  placeholder="Leave blank to use host above"
                />
              </div>
            </div>
          )}

          {checkType === 'cert_file' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="certfile-path">File path</Label>
                <Input
                  id="certfile-path"
                  value={certFilePath}
                  onChange={(e) => setCertFilePath(e.target.value)}
                  placeholder="/etc/ssl/certs/app.pem"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={certFileFormat} onValueChange={(v) => setCertFileFormat(v as 'pem' | 'pkcs12' | 'jks')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pem">PEM (.pem / .crt / .cer)</SelectItem>
                    <SelectItem value="pkcs12">PKCS#12 (.p12 / .pfx)</SelectItem>
                    <SelectItem value="jks">Java KeyStore (.jks)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(certFileFormat === 'pkcs12' || certFileFormat === 'jks') && (
                <div className="space-y-1.5">
                  <Label htmlFor="certfile-password">
                    Password{' '}
                    <span className="text-muted-foreground font-normal">— optional</span>
                  </Label>
                  <Input
                    id="certfile-password"
                    type="password"
                    value={certFilePassword}
                    onChange={(e) => setCertFilePassword(e.target.value)}
                    placeholder="Keystore password"
                  />
                </div>
              )}
              {certFileFormat === 'jks' && (
                <div className="space-y-1.5">
                  <Label htmlFor="certfile-alias">
                    Alias{' '}
                    <span className="text-muted-foreground font-normal">— optional, defaults to first entry</span>
                  </Label>
                  <Input
                    id="certfile-alias"
                    value={certFileAlias}
                    onChange={(e) => setCertFileAlias(e.target.value)}
                    placeholder="mycert"
                  />
                </div>
              )}
            </div>
          )}

          {checkType === 'service_account' && (
            <p className="text-sm text-muted-foreground">
              Discovers all system accounts on this host by reading /etc/passwd and checking for running processes. No additional configuration needed.
            </p>
          )}

          {checkType === 'ssh_key_scan' && (
            <p className="text-sm text-muted-foreground">
              Scans all user home directories for SSH keys (authorized_keys and identity files). Reports key type, fingerprint, and age. No additional configuration needed.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="interval">Interval (seconds)</Label>
            <Input
              id="interval"
              type="number"
              min={10}
              max={3600}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(parseInt(e.target.value, 10) || 60)}
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

function EditCheckDialog({
  check,
  open,
  onOpenChange,
  orgId,
  hostId,
}: {
  check: CheckWithHistory
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  hostId: string
}) {
  const queryClient = useQueryClient()

  const initFields = () => {
    const cfg = check.config as PortCheckConfig & ProcessCheckConfig & HttpCheckConfig & CertificateCheckConfig & CertFileCheckConfig
    return {
      name: check.name,
      intervalSeconds: check.intervalSeconds,
      portHost: cfg.host ?? '',
      portPort: cfg.port != null ? String(cfg.port) : '',
      processName: cfg.process_name ?? '',
      httpUrl: cfg.url ?? '',
      httpStatus: cfg.expected_status != null ? String(cfg.expected_status) : '200',
      certHost: cfg.host ?? '',
      certPort: cfg.port != null ? String(cfg.port) : '443',
      certServerName: cfg.serverName ?? '',
      certFilePath: cfg.filePath ?? '',
      certFileFormat: (cfg.format ?? 'pem') as 'pem' | 'pkcs12' | 'jks',
      certFilePassword: cfg.password ?? '',
      certFileAlias: cfg.alias ?? '',
    }
  }

  const [name, setName] = useState(check.name)
  const [intervalSeconds, setIntervalSeconds] = useState(check.intervalSeconds)
  const [portHost, setPortHost] = useState(() => initFields().portHost)
  const [portPort, setPortPort] = useState(() => initFields().portPort)
  const [processName, setProcessName] = useState(() => initFields().processName)
  const [httpUrl, setHttpUrl] = useState(() => initFields().httpUrl)
  const [httpStatus, setHttpStatus] = useState(() => initFields().httpStatus)
  const [certHost, setCertHost] = useState(() => initFields().certHost)
  const [certPort, setCertPort] = useState(() => initFields().certPort)
  const [certServerName, setCertServerName] = useState(() => initFields().certServerName)
  const [certFilePath, setCertFilePath] = useState(() => initFields().certFilePath)
  const [certFileFormat, setCertFileFormat] = useState<'pem' | 'pkcs12' | 'jks'>(() => initFields().certFileFormat)
  const [certFilePassword, setCertFilePassword] = useState(() => initFields().certFilePassword)
  const [certFileAlias, setCertFileAlias] = useState(() => initFields().certFileAlias)
  const [error, setError] = useState('')
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)

  // Re-sync when the dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      const f = initFields()
      setName(f.name)
      setIntervalSeconds(check.intervalSeconds)
      setPortHost(f.portHost)
      setPortPort(f.portPort)
      setProcessName(f.processName)
      setHttpUrl(f.httpUrl)
      setHttpStatus(f.httpStatus)
      setCertHost(f.certHost)
      setCertPort(f.certPort)
      setCertServerName(f.certServerName)
      setCertFilePath(f.certFilePath)
      setCertFileFormat(f.certFileFormat)
      setCertFilePassword(f.certFilePassword)
      setCertFileAlias(f.certFileAlias)
      setError('')
      setConfirmClearHistory(false)
    }
    onOpenChange(v)
  }

  const { mutate: clearHistory, isPending: isClearingHistory } = useMutation({
    mutationFn: () => deleteCheckHistory(orgId, check.id),
    onSuccess: (result) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['checks-history', orgId, hostId] })
      setConfirmClearHistory(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    },
  })

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      let config: unknown
      if (check.checkType === 'port') {
        config = { host: portHost, port: parseInt(portPort, 10) }
      } else if (check.checkType === 'process') {
        config = { process_name: processName }
      } else if (check.checkType === 'certificate') {
        const certConfig: CertificateCheckConfig = { host: certHost, port: parseInt(certPort, 10) || 443 }
        if (certServerName) certConfig.serverName = certServerName
        config = certConfig
      } else if (check.checkType === 'cert_file') {
        const certFileConfig: CertFileCheckConfig = { filePath: certFilePath, format: certFileFormat }
        if (certFilePassword) certFileConfig.password = certFilePassword
        if (certFileAlias) certFileConfig.alias = certFileAlias
        config = certFileConfig
      } else if (check.checkType === 'service_account') {
        config = {}
      } else if (check.checkType === 'ssh_key_scan') {
        config = {}
      } else {
        config = { url: httpUrl, expected_status: parseInt(httpStatus, 10) || 200 }
      }
      return updateCheck(orgId, check.id, { name, config, intervalSeconds })
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setError(result.error)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['checks-history', orgId, hostId] })
      onOpenChange(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    },
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Check</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-check-name">Name</Label>
            <Input
              id="edit-check-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {check.checkType === 'port' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-port-host">Host</Label>
                <Input
                  id="edit-port-host"
                  value={portHost}
                  onChange={(e) => setPortHost(e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-port-port">Port</Label>
                <Input
                  id="edit-port-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={portPort}
                  onChange={(e) => setPortPort(e.target.value)}
                />
              </div>
            </div>
          )}

          {check.checkType === 'process' && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-process-name">Process name</Label>
              <Input
                id="edit-process-name"
                value={processName}
                onChange={(e) => setProcessName(e.target.value)}
              />
            </div>
          )}

          {check.checkType === 'http' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-http-url">URL</Label>
                <Input
                  id="edit-http-url"
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-http-status">Expected status code</Label>
                <Input
                  id="edit-http-status"
                  type="number"
                  value={httpStatus}
                  onChange={(e) => setHttpStatus(e.target.value)}
                />
              </div>
            </div>
          )}

          {check.checkType === 'certificate' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-cert-host">Host</Label>
                  <Input
                    id="edit-cert-host"
                    value={certHost}
                    onChange={(e) => setCertHost(e.target.value)}
                    placeholder="example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-cert-port">Port</Label>
                  <Input
                    id="edit-cert-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={certPort}
                    onChange={(e) => setCertPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cert-sni">
                  Server name (SNI){' '}
                  <span className="text-muted-foreground font-normal">— optional</span>
                </Label>
                <Input
                  id="edit-cert-sni"
                  value={certServerName}
                  onChange={(e) => setCertServerName(e.target.value)}
                  placeholder="Leave blank to use host above"
                />
              </div>
            </div>
          )}

          {check.checkType === 'cert_file' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-certfile-path">File path</Label>
                <Input
                  id="edit-certfile-path"
                  value={certFilePath}
                  onChange={(e) => setCertFilePath(e.target.value)}
                  placeholder="/etc/ssl/certs/app.pem"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={certFileFormat} onValueChange={(v) => setCertFileFormat(v as 'pem' | 'pkcs12' | 'jks')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pem">PEM (.pem / .crt / .cer)</SelectItem>
                    <SelectItem value="pkcs12">PKCS#12 (.p12 / .pfx)</SelectItem>
                    <SelectItem value="jks">Java KeyStore (.jks)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(certFileFormat === 'pkcs12' || certFileFormat === 'jks') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-certfile-password">
                    Password{' '}
                    <span className="text-muted-foreground font-normal">— optional</span>
                  </Label>
                  <Input
                    id="edit-certfile-password"
                    type="password"
                    value={certFilePassword}
                    onChange={(e) => setCertFilePassword(e.target.value)}
                    placeholder="Keystore password"
                  />
                </div>
              )}
              {certFileFormat === 'jks' && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-certfile-alias">
                    Alias{' '}
                    <span className="text-muted-foreground font-normal">— optional, defaults to first entry</span>
                  </Label>
                  <Input
                    id="edit-certfile-alias"
                    value={certFileAlias}
                    onChange={(e) => setCertFileAlias(e.target.value)}
                    placeholder="mycert"
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-interval">Interval (seconds)</Label>
            <Input
              id="edit-interval"
              type="number"
              min={10}
              max={3600}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(parseInt(e.target.value, 10) || 60)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            {confirmClearHistory ? (
              <>
                <span className="text-sm text-muted-foreground">Delete all history?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => clearHistory()}
                  disabled={isClearingHistory}
                >
                  {isClearingHistory ? 'Deleting...' : 'Confirm'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmClearHistory(false)}
                  disabled={isClearingHistory}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-red-600"
                onClick={() => setConfirmClearHistory(true)}
                disabled={check.results.length === 0}
              >
                Delete history
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => mutate()} disabled={isPending || !name}>
              {isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
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
  check: CheckWithHistory
  orgId: string
  hostId: string
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { mutate: toggleEnabled } = useMutation({
    mutationFn: (enabled: boolean) => updateCheck(orgId, check.id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checks-history', orgId, hostId] }),
  })

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: () => deleteCheck(orgId, check.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checks-history', orgId, hostId] }),
  })

  return (
    <>
    <div className="border rounded-lg">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{check.name}</span>
            <CheckTypeBadge type={check.checkType} />
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusDots results={check.results} />
            <StatusWeather results={check.results} />
            {check.latestResult && (
              <span className="text-xs text-muted-foreground">
                · {formatDistanceToNow(new Date(check.latestResult.ranAt), { addSuffix: true })}
              </span>
            )}
          </div>
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
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => setEditOpen(true)}
            aria-label="Edit check"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-red-600"
            onClick={() => setDeleteOpen(true)}
            disabled={isDeleting}
            aria-label="Delete check"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-3 pt-3 pb-3">
          {check.results.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                {check.results.length} result{check.results.length === 1 ? '' : 's'} stored
                {check.latestResult?.output && (
                  <> · <span className="text-foreground">{formatCheckOutput(check.checkType, check.latestResult.output)}</span></>
                )}
              </p>
              <CheckHistoryChart results={check.results} checkType={check.checkType} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-2">No results yet.</p>
          )}
        </div>
      )}
    </div>

    <EditCheckDialog
      check={check}
      open={editOpen}
      onOpenChange={setEditOpen}
      orgId={orgId}
      hostId={hostId}
    />

    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete check</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{check.name}</strong>? This will remove all
            associated history and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => remove()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

function flapCount(results: CheckResultRow[]): number {
  let flaps = 0
  for (let i = 1; i < results.length; i++) {
    if (results[i]!.status !== results[i - 1]!.status) flaps++
  }
  return flaps
}

function mostRecentNegativeMs(results: CheckResultRow[]): number {
  const hit = results.find((r) => r.status === 'fail' || r.status === 'error')
  return hit ? new Date(hit.ranAt).getTime() : 0
}

function sortedChecks(checks: CheckWithHistory[]): CheckWithHistory[] {
  return [...checks].sort((a, b) => {
    const flapsB = flapCount(b.results)
    const flapsA = flapCount(a.results)
    if (flapsB !== flapsA) return flapsB - flapsA
    return mostRecentNegativeMs(b.results) - mostRecentNegativeMs(a.results)
  })
}

export function ChecksTab({ orgId, hostId }: Props) {
  const [addOpen, setAddOpen] = useState(false)

  const { data: rawChecks = [], isLoading } = useQuery({
    queryKey: ['checks-history', orgId, hostId],
    queryFn: () => getChecksWithHistory(orgId, hostId),
    refetchInterval: 30_000,
  })

  const checks = sortedChecks(rawChecks)

  const healthSummary = (() => {
    if (checks.length === 0) return null
    const passing = checks.filter((c) => c.latestResult?.status === 'pass').length
    const failing = checks.filter((c) => c.latestResult?.status === 'fail' || c.latestResult?.status === 'error').length
    const pending = checks.filter((c) => !c.latestResult).length
    const total = checks.length
    const passRatio = total > 0 ? passing / total : 0

    let WeatherIcon: typeof Sun
    let iconClass: string
    let headline: string
    if (passRatio === 1) {
      WeatherIcon = Sun; iconClass = 'text-amber-400'; headline = 'All checks passing'
    } else if (passRatio >= 0.8) {
      WeatherIcon = CloudSun; iconClass = 'text-amber-400'; headline = 'Mostly healthy'
    } else if (passRatio >= 0.4) {
      WeatherIcon = CloudRain; iconClass = 'text-blue-400'; headline = 'Partially degraded'
    } else if (passing === 0 && pending === total) {
      WeatherIcon = Cloud; iconClass = 'text-muted-foreground'; headline = 'Awaiting results'
    } else {
      WeatherIcon = CloudLightning; iconClass = 'text-red-500'; headline = 'Degraded'
    }

    return { WeatherIcon, iconClass, headline, passing, failing, pending, total }
  })()

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

      {healthSummary && (
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <healthSummary.WeatherIcon className={`size-10 shrink-0 ${healthSummary.iconClass}`} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">{healthSummary.headline}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {healthSummary.passing} passing
                {healthSummary.failing > 0 && (
                  <> · <span className="text-red-600 font-medium">{healthSummary.failing} failing</span></>
                )}
                {healthSummary.pending > 0 && (
                  <> · {healthSummary.pending} pending</>
                )}
                {' '}of {healthSummary.total} check{healthSummary.total === 1 ? '' : 's'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

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
