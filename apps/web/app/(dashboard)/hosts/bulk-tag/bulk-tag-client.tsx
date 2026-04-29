'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
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
import { previewHostFilter, bulkAssignTags, createTagRule } from '@/lib/actions/tag-rules'
import { TagEditor, type EditorTag } from '@/components/shared/tag-editor'
import type { HostFilter } from '@/lib/db/schema'
import type { HostFilterResult } from '@/lib/hosts/filter'

interface BulkTagClientProps {
  orgId: string
}

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function BulkTagClient({ orgId }: BulkTagClientProps) {
  const [hostnameGlob, setHostnameGlob] = useState('')
  const [hostnameContains, setHostnameContains] = useState('')
  const [ipCidrs, setIpCidrs] = useState('')
  const [osList, setOsList] = useState('')
  const [archList, setArchList] = useState('')
  const [statusList, setStatusList] = useState('')
  const [tags, setTags] = useState<EditorTag[]>([])
  const [preview, setPreview] = useState<HostFilterResult[] | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  function buildFilter(): HostFilter {
    const filter: HostFilter = {}
    if (hostnameGlob.trim()) filter.hostnameGlob = hostnameGlob.trim()
    if (hostnameContains.trim()) filter.hostnameContains = hostnameContains.trim()
    const cidrs = splitList(ipCidrs)
    if (cidrs.length > 0) filter.ipCidrs = cidrs
    const os = splitList(osList)
    if (os.length > 0) filter.os = os
    const arch = splitList(archList)
    if (arch.length > 0) filter.arch = arch
    const statuses = splitList(statusList).filter(
      (s): s is 'online' | 'offline' | 'unknown' =>
        s === 'online' || s === 'offline' || s === 'unknown',
    )
    if (statuses.length > 0) filter.status = statuses
    return filter
  }

  const previewMutation = useMutation({
    mutationFn: async () => previewHostFilter(orgId, buildFilter()),
    onSuccess: (rows) => {
      setPreview(rows)
      setMessage(null)
    },
    onError: () => setMessage({ kind: 'error', text: 'Failed to preview matches' }),
  })

  const applyMutation = useMutation({
    mutationFn: async () =>
      bulkAssignTags(
        orgId,
        buildFilter(),
        tags.map((t) => ({ key: t.key, value: t.value })),
      ),
    onSuccess: (result) => {
      if ('error' in result) {
        setMessage({ kind: 'error', text: result.error })
        return
      }
      setMessage({ kind: 'info', text: `Applied tags to ${result.applied} host(s).` })
    },
    onError: () => setMessage({ kind: 'error', text: 'Failed to apply tags' }),
  })

  const saveRuleMutation = useMutation({
    mutationFn: async () =>
      createTagRule(orgId, {
        name: ruleName.trim(),
        filter: buildFilter(),
        tags: tags.map((t) => ({ key: t.key, value: t.value })),
      }),
    onSuccess: (result) => {
      if ('error' in result) {
        setMessage({ kind: 'error', text: result.error })
        return
      }
      setSaveOpen(false)
      setRuleName('')
      setMessage({ kind: 'info', text: 'Rule saved — it will auto-apply to matching hosts on approval.' })
    },
    onError: () => setMessage({ kind: 'error', text: 'Failed to save rule' }),
  })

  const canApply = tags.length > 0 && (preview?.length ?? 0) > 0

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="bulk-tag-heading">Bulk Tag Hosts</h1>
        <p className="text-muted-foreground text-sm">
          Select hosts by filter, preview matches, and apply tags. Optionally save the filter as a
          rule that auto-applies to future matching hosts at approval time.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            message.kind === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-secondary bg-secondary text-secondary-foreground'
          }`}
          data-testid="bulk-tag-message"
        >
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>All supplied fields AND together.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hostnameGlob">Hostname glob</Label>
            <Input
              id="hostnameGlob"
              placeholder="web-*.prod"
              value={hostnameGlob}
              onChange={(e) => setHostnameGlob(e.target.value)}
              data-testid="bulk-tag-filter-hostname-glob"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hostnameContains">Hostname contains</Label>
            <Input
              id="hostnameContains"
              placeholder="db"
              value={hostnameContains}
              onChange={(e) => setHostnameContains(e.target.value)}
              data-testid="bulk-tag-filter-hostname-contains"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ipCidrs">IP CIDRs (comma or space-separated)</Label>
            <Input
              id="ipCidrs"
              placeholder="10.0.0.0/8 192.168.1.0/24"
              value={ipCidrs}
              onChange={(e) => setIpCidrs(e.target.value)}
              data-testid="bulk-tag-filter-ip-cidrs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="osList">OS (comma-separated)</Label>
            <Input
              id="osList"
              placeholder="linux, windows"
              value={osList}
              onChange={(e) => setOsList(e.target.value)}
              data-testid="bulk-tag-filter-os"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="archList">Arch (comma-separated)</Label>
            <Input
              id="archList"
              placeholder="amd64, arm64"
              value={archList}
              onChange={(e) => setArchList(e.target.value)}
              data-testid="bulk-tag-filter-arch"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="statusList">Status (online, offline, unknown)</Label>
            <Input
              id="statusList"
              placeholder="online"
              value={statusList}
              onChange={(e) => setStatusList(e.target.value)}
              data-testid="bulk-tag-filter-status"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tags to apply</CardTitle>
          <CardDescription>
            One value per key; existing values on matching hosts are overwritten for the supplied
            keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TagEditor orgId={orgId} value={tags} onChange={setTags} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
          data-testid="bulk-tag-preview"
        >
          Preview matches
        </Button>
        <Button
          onClick={() => applyMutation.mutate()}
          disabled={!canApply || applyMutation.isPending}
          data-testid="bulk-tag-apply"
        >
          Apply tags
        </Button>
        <Button
          variant="secondary"
          onClick={() => setSaveOpen(true)}
          disabled={tags.length === 0}
          data-testid="bulk-tag-save-open"
        >
          Save as rule
        </Button>
      </div>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle data-testid="bulk-tag-preview-heading">Matching hosts ({preview.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {preview.length === 0 ? (
              <p className="text-muted-foreground text-sm" data-testid="bulk-tag-preview-empty">No hosts match the current filter.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hostname</TableHead>
                    <TableHead>OS</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP addresses</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((h) => (
                    <TableRow key={h.id} data-testid={`bulk-tag-preview-row-${h.id}`}>
                      <TableCell>{h.displayName ?? h.hostname}</TableCell>
                      <TableCell>{h.os ?? '—'}</TableCell>
                      <TableCell>{h.status}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {(h.ipAddresses ?? []).join(', ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as tag rule</DialogTitle>
            <DialogDescription>
              Saved rules evaluate on host approval and can be re-run on demand from Tag Rules
              settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ruleName">Rule name</Label>
            <Input
              id="ruleName"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="EU prod zone"
              data-testid="bulk-tag-rule-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveRuleMutation.mutate()}
              disabled={!ruleName.trim() || saveRuleMutation.isPending}
              data-testid="bulk-tag-rule-save"
            >
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
