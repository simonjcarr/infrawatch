'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { formatDistanceToNow, format } from 'date-fns'
import { Plus, Trash2, Copy, Check, Key, RefreshCw, Eye, Package, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  listEnrolmentTokens,
  createEnrolmentToken,
  revokeEnrolmentToken,
} from '@/lib/actions/agents'
import type { AgentEnrolmentToken } from '@/lib/db/schema'

const createTokenSchema = z.object({
  label: z.string().min(1, 'Label is required').max(100),
  autoApprove: z.boolean(),
  skipVerify: z.boolean(),
  maxUses: z.string().optional(),
  expiresInDays: z.string().optional(),
})

type CreateTokenForm = z.infer<typeof createTokenSchema>

interface AgentsSettingsClientProps {
  orgId: string
  currentUserId: string
  initialTokens: AgentEnrolmentToken[]
  appUrl: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 w-6 p-0">
      {copied ? (
        <Check className="size-3 text-green-600" />
      ) : (
        <Copy className="size-3 text-muted-foreground" />
      )}
    </Button>
  )
}

function buildInstallCommand(token: string, skipVerify: boolean, appUrl: string): string {
  const origin = appUrl.replace(/\/$/, '') || window.location.origin
  const installUrl = new URL(`${origin}/api/agent/install`)
  installUrl.searchParams.set('token', token)
  if (skipVerify) {
    installUrl.searchParams.set('skip_verify', 'true')
  }
  return `curl -fsSL "${installUrl.toString()}" | sudo bash`
}

function tokenStatus(token: AgentEnrolmentToken): { label: string; className: string } {
  if (token.deletedAt) {
    return { label: 'Revoked', className: 'bg-red-100 text-red-800 border-red-200' }
  }
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return { label: 'Expired', className: 'bg-gray-100 text-gray-600 border-gray-200' }
  }
  if (token.maxUses !== null && token.usageCount >= token.maxUses) {
    return { label: 'Exhausted', className: 'bg-gray-100 text-gray-600 border-gray-200' }
  }
  return { label: 'Active', className: 'bg-green-100 text-green-800 border-green-200' }
}

export function AgentsSettingsClient({
  orgId,
  currentUserId,
  initialTokens,
  appUrl,
}: AgentsSettingsClientProps) {
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null)
  const [newInstallCommand, setNewInstallCommand] = useState<string | null>(null)
  const [viewToken, setViewToken] = useState<AgentEnrolmentToken | null>(null)
  const [showBundleDialog, setShowBundleDialog] = useState(false)

  const { data: tokens } = useQuery({
    queryKey: ['enrolment-tokens', orgId],
    queryFn: () => listEnrolmentTokens(orgId),
    initialData: initialTokens,
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<CreateTokenForm>({
    resolver: zodResolver(createTokenSchema),
    defaultValues: { label: '', autoApprove: false, skipVerify: true },
  })

  const autoApprove = watch('autoApprove')
  const skipVerify = watch('skipVerify')

  const createMutation = useMutation({
    mutationFn: (data: CreateTokenForm) =>
      createEnrolmentToken(orgId, currentUserId, {
        label: data.label,
        autoApprove: data.autoApprove,
        skipVerify: data.skipVerify,
        maxUses: data.maxUses !== '' && data.maxUses ? Number(data.maxUses) : undefined,
        expiresInDays:
          data.expiresInDays !== '' && data.expiresInDays ? Number(data.expiresInDays) : undefined,
      }),
    onSuccess: (result, variables) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['enrolment-tokens', orgId] })
      setNewTokenValue(result.token)
      setNewInstallCommand(buildInstallCommand(result.token, variables.skipVerify, appUrl))
      reset()
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => revokeEnrolmentToken(orgId, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrolment-tokens', orgId] })
    },
  })

  const onSubmit = handleSubmit((data) => createMutation.mutate(data))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Agent Enrolment</h1>
        <p className="text-muted-foreground mt-1">
          Manage enrolment tokens used to register new agents with your organisation.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="size-4 text-muted-foreground" />
              Enrolment Tokens
            </CardTitle>
            <CardDescription className="mt-1">
              Create an enrolment token to get a one-command install script for registering new
              agents.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowBundleDialog(true)}>
              <Package className="size-4 mr-1" />
              Download Install Bundle
            </Button>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="size-4 mr-1" />
              New Token
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <div className="text-center py-10">
              <Key className="size-8 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No enrolment tokens yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a token to allow agents to register.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Auto-approve</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const status = tokenStatus(token)
                  const isActive = status.label === 'Active'
                  return (
                    <TableRow key={token.id}>
                      <TableCell className="font-medium">{token.label}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                            {token.token.slice(0, 8)}…{token.token.slice(-4)}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => setViewToken(token)}
                          >
                            <Eye className="size-3 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {token.autoApprove ? (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {token.usageCount}
                        {token.maxUses !== null ? ` / ${token.maxUses}` : ''}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {token.expiresAt
                          ? format(new Date(token.expiresAt), 'dd MMM yyyy')
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${status.className}`}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7"
                            onClick={() => revokeMutation.mutate(token.id)}
                            disabled={revokeMutation.isPending}
                          >
                            <Trash2 className="size-3.5 mr-1" />
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewToken} onOpenChange={(open) => { if (!open) setViewToken(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token: {viewToken?.label}</DialogTitle>
            <DialogDescription>
              Use the curl command to enrol a new agent, or copy the raw token for manual configuration.
            </DialogDescription>
          </DialogHeader>
          {viewToken && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Install command</p>
                <div className="flex items-start gap-2 p-3 bg-muted rounded-md">
                  <code className="text-xs font-mono flex-1 break-all leading-relaxed">
                    {buildInstallCommand(viewToken.token, viewToken.skipVerify, appUrl)}
                  </code>
                  <CopyButton text={buildInstallCommand(viewToken.token, viewToken.skipVerify, appUrl)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Raw token</p>
                <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                  <code className="text-xs font-mono flex-1 break-all">{viewToken.token}</code>
                  <CopyButton text={viewToken.token} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setViewToken(null)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open)
          if (!open) {
            setNewTokenValue(null)
            setNewInstallCommand(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Enrolment Token</DialogTitle>
            <DialogDescription>
              Agents use this token to register with your organisation. You&apos;ll get a
              ready-to-run install command.
            </DialogDescription>
          </DialogHeader>

          {newTokenValue && newInstallCommand ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Token created. Run this command on each server you want to enrol:
              </p>

              <div className="flex items-start gap-2 p-3 bg-muted rounded-md">
                <code className="text-xs font-mono flex-1 break-all leading-relaxed">
                  {newInstallCommand}
                </code>
                <CopyButton text={newInstallCommand} />
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                  Show raw token (for manual config)
                </summary>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                    <code className="text-xs font-mono flex-1 break-all">{newTokenValue}</code>
                    <CopyButton text={newTokenValue} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This token will not be shown again in full.
                  </p>
                </div>
              </details>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setShowCreateDialog(false)
                    setNewTokenValue(null)
                    setNewInstallCommand(null)
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  placeholder="e.g. Production servers"
                  {...register('label')}
                />
                {errors.label && (
                  <p className="text-sm text-destructive">{errors.label.message}</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="autoApprove"
                  className="h-4 w-4 rounded border-border"
                  checked={autoApprove}
                  onChange={(e) => setValue('autoApprove', e.target.checked)}
                />
                <div>
                  <Label htmlFor="autoApprove" className="font-normal cursor-pointer">
                    Auto-approve agents
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Agents registered with this token are automatically approved without manual
                    review.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="skipVerify"
                  className="h-4 w-4 rounded border-border"
                  checked={skipVerify}
                  onChange={(e) => setValue('skipVerify', e.target.checked)}
                />
                <div>
                  <Label htmlFor="skipVerify" className="font-normal cursor-pointer">
                    Accept self-signed certificates
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Enable if your ingest service uses a self-signed or private CA certificate.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxUses">Max uses (optional)</Label>
                  <Input
                    id="maxUses"
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    {...register('maxUses')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiresInDays">Expires in days (optional)</Label>
                  <Input
                    id="expiresInDays"
                    type="number"
                    min="1"
                    placeholder="Never"
                    {...register('expiresInDays')}
                  />
                </div>
              </div>

              {createMutation.data && 'error' in createMutation.data && (
                <p className="text-sm text-destructive">{createMutation.data.error}</p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <>
                      <RefreshCw className="size-3.5 mr-1 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    'Create Token'
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <BundleDialog
        open={showBundleDialog}
        onOpenChange={setShowBundleDialog}
        activeTokens={(tokens ?? []).filter((t) => tokenStatus(t).label === 'Active')}
      />
    </div>
  )
}

// ── Install bundle dialog ─────────────────────────────────────────────────────

type BundleOS = 'linux' | 'darwin' | 'windows'
type BundleArch = 'amd64' | 'arm64'
type TokenMode = 'create' | 'existing' | 'none'

interface BundleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeTokens: AgentEnrolmentToken[]
}

function BundleDialog({ open, onOpenChange, activeTokens }: BundleDialogProps) {
  const [os, setOs] = useState<BundleOS>('linux')
  const [arch, setArch] = useState<BundleArch>('amd64')
  const [tokenMode, setTokenMode] = useState<TokenMode>('create')
  const [tokenLabel, setTokenLabel] = useState('Install bundle')
  const [expiresInDays, setExpiresInDays] = useState('7')
  const [autoApprove, setAutoApprove] = useState(false)
  const [skipVerify, setSkipVerify] = useState(true)
  const [ingestAddress, setIngestAddress] = useState('')
  const [existingTokenId, setExistingTokenId] = useState<string>(activeTokens[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  // Reset server-side errors when the dialog is reopened.
  function reset() {
    setError(null)
    setIsGenerating(false)
  }

  async function handleDownload() {
    reset()
    setIsGenerating(true)

    const body: Record<string, unknown> = { os, arch }
    if (ingestAddress.trim()) body.ingestAddress = ingestAddress.trim()

    if (tokenMode === 'create') {
      const days = Number(expiresInDays)
      if (!Number.isFinite(days) || days < 1) {
        setError('Expiry must be a positive number of days.')
        setIsGenerating(false)
        return
      }
      body.createToken = {
        label: tokenLabel.trim() || 'Install bundle',
        autoApprove,
        skipVerify,
        expiresInDays: days,
      }
    } else if (tokenMode === 'existing') {
      if (!existingTokenId) {
        setError('Select a token to embed in the bundle.')
        setIsGenerating(false)
        return
      }
      body.tokenId = existingTokenId
    } else {
      // No token — operator supplies it at install time.
      body.skipVerify = skipVerify
    }

    try {
      const res = await fetch('/api/agent/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const contentType = res.headers.get('content-type') ?? ''
        const message = contentType.includes('application/json')
          ? (await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`
          : `Request failed (${res.status})`
        setError(String(message))
        setIsGenerating(false)
        return
      }
      const disposition = res.headers.get('content-disposition') ?? ''
      const filenameMatch = /filename="?([^";]+)"?/.exec(disposition)
      const filename = filenameMatch?.[1] ?? `infrawatch-agent-${os}-${arch}.zip`

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setIsGenerating(false)
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      setError('Network error while generating bundle.')
      setIsGenerating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Download Install Bundle</DialogTitle>
          <DialogDescription>
            Generate a zip containing the agent binary, install script, config template, and
            checksum — ready to transfer to an air-gapped host.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bundle-os">Operating system</Label>
              <Select value={os} onValueChange={(v) => setOs(v as BundleOS)}>
                <SelectTrigger id="bundle-os">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linux">Linux</SelectItem>
                  <SelectItem value="darwin">macOS</SelectItem>
                  <SelectItem value="windows">Windows</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bundle-arch">Architecture</Label>
              <Select value={arch} onValueChange={(v) => setArch(v as BundleArch)}>
                <SelectTrigger id="bundle-arch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amd64">amd64 (x86_64)</SelectItem>
                  <SelectItem value="arm64">arm64 (aarch64)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bundle-ingest">Ingest address (optional)</Label>
            <Input
              id="bundle-ingest"
              placeholder="Defaults to this server's hostname:9443"
              value={ingestAddress}
              onChange={(e) => setIngestAddress(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The gRPC ingest host:port the agent will connect to. Leave blank to use this
              server&apos;s hostname.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Enrolment token</Label>
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tokenMode"
                  value="create"
                  checked={tokenMode === 'create'}
                  onChange={() => setTokenMode('create')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">Create a new single-use token</span>
                  <p className="text-xs text-muted-foreground">
                    A fresh token is generated, limited to one use and expiring after the chosen
                    number of days.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tokenMode"
                  value="existing"
                  checked={tokenMode === 'existing'}
                  onChange={() => setTokenMode('existing')}
                  disabled={activeTokens.length === 0}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">Embed an existing token</span>
                  <p className="text-xs text-muted-foreground">
                    {activeTokens.length === 0
                      ? 'No active tokens available.'
                      : 'Use one of your currently active enrolment tokens.'}
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tokenMode"
                  value="none"
                  checked={tokenMode === 'none'}
                  onChange={() => setTokenMode('none')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">No token (operator supplies it)</span>
                  <p className="text-xs text-muted-foreground">
                    Installer reads the token from <code>INFRAWATCH_ORG_TOKEN</code> at install
                    time — safest for wide distribution.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {tokenMode === 'create' && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="bundle-label">Token label</Label>
                <Input
                  id="bundle-label"
                  value={tokenLabel}
                  onChange={(e) => setTokenLabel(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bundle-expires">Expires in days</Label>
                <Input
                  id="bundle-expires"
                  type="number"
                  min="1"
                  max="365"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="bundle-autoapprove"
                  className="h-4 w-4 rounded border-border"
                  checked={autoApprove}
                  onChange={(e) => setAutoApprove(e.target.checked)}
                />
                <Label htmlFor="bundle-autoapprove" className="font-normal cursor-pointer">
                  Auto-approve the agent on registration
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="bundle-skipverify"
                  className="h-4 w-4 rounded border-border"
                  checked={skipVerify}
                  onChange={(e) => setSkipVerify(e.target.checked)}
                />
                <Label htmlFor="bundle-skipverify" className="font-normal cursor-pointer">
                  Accept self-signed TLS certificates
                </Label>
              </div>
            </div>
          )}

          {tokenMode === 'existing' && activeTokens.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="bundle-existing-token">Active token</Label>
              <Select value={existingTokenId} onValueChange={setExistingTokenId}>
                <SelectTrigger id="bundle-existing-token">
                  <SelectValue placeholder="Select a token" />
                </SelectTrigger>
                <SelectContent>
                  {activeTokens.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {tokenMode === 'none' && (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="bundle-skipverify-none"
                className="h-4 w-4 rounded border-border"
                checked={skipVerify}
                onChange={(e) => setSkipVerify(e.target.checked)}
              />
              <Label htmlFor="bundle-skipverify-none" className="font-normal cursor-pointer">
                Write <code>tls_skip_verify = true</code> in the config
              </Label>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <RefreshCw className="size-3.5 mr-1 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Download className="size-3.5 mr-1" />
                Download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
