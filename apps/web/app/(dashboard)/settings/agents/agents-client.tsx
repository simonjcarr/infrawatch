'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { formatDistanceToNow, format } from 'date-fns'
import { Plus, Trash2, Copy, Check, Key, RefreshCw } from 'lucide-react'
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
}: AgentsSettingsClientProps) {
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null)
  const [newInstallCommand, setNewInstallCommand] = useState<string | null>(null)

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
        maxUses: data.maxUses !== '' && data.maxUses ? Number(data.maxUses) : undefined,
        expiresInDays:
          data.expiresInDays !== '' && data.expiresInDays ? Number(data.expiresInDays) : undefined,
      }),
    onSuccess: (result, variables) => {
      if ('error' in result) return
      queryClient.invalidateQueries({ queryKey: ['enrolment-tokens', orgId] })
      setNewTokenValue(result.token)
      const installUrl = new URL(`${window.location.origin}/api/agent/install`)
      installUrl.searchParams.set('token', result.token)
      if (variables.skipVerify) {
        installUrl.searchParams.set('skip_verify', 'true')
      }
      setNewInstallCommand(`curl -fsSL "${installUrl.toString()}" | sudo bash`)
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
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="size-4 mr-1" />
            New Token
          </Button>
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
                          <CopyButton text={token.token} />
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
    </div>
  )
}
