'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Power, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  listTagRules,
  deleteTagRule,
  runTagRule,
  updateTagRule,
} from '@/lib/actions/tag-rules'
import type { TagRule } from '@/lib/db/schema'

interface TagRulesClientProps {
  orgId: string
  initialRules: TagRule[]
}

function summariseFilter(filter: TagRule['filter']): string {
  const parts: string[] = []
  if (filter.hostnameGlob) parts.push(`hostname~${filter.hostnameGlob}`)
  if (filter.hostnameContains) parts.push(`hostname contains "${filter.hostnameContains}"`)
  if (filter.ipCidrs?.length) parts.push(`cidrs ${filter.ipCidrs.join(',')}`)
  if (filter.os?.length) parts.push(`os=${filter.os.join('|')}`)
  if (filter.arch?.length) parts.push(`arch=${filter.arch.join('|')}`)
  if (filter.status?.length) parts.push(`status=${filter.status.join('|')}`)
  if (filter.hasTags?.length)
    parts.push(`has ${filter.hasTags.map((t) => (t.value ? `${t.key}:${t.value}` : t.key)).join(', ')}`)
  if (filter.lacksTags?.length)
    parts.push(`lacks ${filter.lacksTags.map((t) => (t.value ? `${t.key}:${t.value}` : t.key)).join(', ')}`)
  return parts.join(' AND ') || '(empty filter — matches nothing)'
}

export function TagRulesClient({ orgId, initialRules }: TagRulesClientProps) {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const { data: rules = initialRules } = useQuery({
    queryKey: ['tag-rules', orgId],
    queryFn: () => listTagRules(orgId),
    initialData: initialRules,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tag-rules', orgId] })

  const runMutation = useMutation({
    mutationFn: (ruleId: string) => runTagRule(orgId, ruleId),
    onSuccess: (result) => {
      if ('error' in result) setMessage({ kind: 'error', text: result.error })
      else setMessage({ kind: 'info', text: `Applied rule to ${result.applied} host(s).` })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      updateTagRule(orgId, ruleId, { enabled }),
    onSuccess: (result) => {
      if ('error' in result) setMessage({ kind: 'error', text: result.error })
      invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteTagRule(orgId, ruleId),
    onSuccess: (result) => {
      if ('error' in result) setMessage({ kind: 'error', text: result.error })
      else setMessage({ kind: 'info', text: 'Rule deleted.' })
      invalidate()
    },
  })

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="tag-rules-heading">Tag Rules</h1>
        <p className="text-muted-foreground text-sm">
          Rules auto-apply tags to hosts that match their filter. Evaluated at host approval and
          when you click Run.
        </p>
      </div>

      {message && (
        <div
          data-testid="tag-rules-message"
          className={`rounded-md border p-3 text-sm ${
            message.kind === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-secondary bg-secondary text-secondary-foreground'
          }`}
        >
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Saved rules</CardTitle>
          <CardDescription>
            Create rules from the{' '}
            <Link className="underline" href="/hosts/bulk-tag">
              Bulk Tag
            </Link>{' '}
            page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rules saved yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Filter</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id} data-testid={`tag-rule-row-${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">
                      {summariseFilter(r.filter)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <Badge key={`${t.key}:${t.value}`} variant="secondary">
                            {t.key}:{t.value}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.enabled ? (
                        <Badge>Enabled</Badge>
                      ) : (
                        <Badge variant="outline">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Run now"
                          data-testid={`tag-rule-run-${r.id}`}
                          aria-label={`Run tag rule ${r.name}`}
                          onClick={() => runMutation.mutate(r.id)}
                          disabled={runMutation.isPending}
                        >
                          <Play className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={r.enabled ? 'Disable' : 'Enable'}
                          data-testid={`tag-rule-toggle-${r.id}`}
                          aria-label={`${r.enabled ? 'Disable' : 'Enable'} tag rule ${r.name}`}
                          onClick={() =>
                            toggleMutation.mutate({ ruleId: r.id, enabled: !r.enabled })
                          }
                          disabled={toggleMutation.isPending}
                        >
                          <Power className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete"
                          data-testid={`tag-rule-delete-${r.id}`}
                          aria-label={`Delete tag rule ${r.name}`}
                          onClick={() => deleteMutation.mutate(r.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
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
