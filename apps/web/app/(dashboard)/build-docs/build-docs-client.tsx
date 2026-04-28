'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, Plus, Search, Settings, Scissors, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createBuildDoc,
  createBuildDocSnippet,
  createBuildDocTemplate,
  listBuildDocs,
  listBuildDocSnippets,
  listBuildDocTemplates,
  saveBuildDocAssetStorageSettings,
  searchBuildDocs,
  type BuildDocListItem,
  type BuildDocTemplateWithVersion,
} from '@/lib/actions/build-docs'
import type {
  BuildDocAssetStorageSettings,
  BuildDocSnippet,
  BuildDocStorageSettingsConfig,
} from '@/lib/db/schema'

function defaultTemplateFields() {
  return JSON.stringify([
    { id: 'customer', label: 'Customer', type: 'text', required: true },
    { id: 'changeRef', label: 'Change reference', type: 'text', required: false },
    { id: 'production', label: 'Production VM', type: 'boolean', required: true },
  ], null, 2)
}

export function BuildDocsClient({
  orgId,
  userRole,
  initialDocs,
  initialTemplates,
  initialSnippets,
  initialStorageSettings,
}: {
  orgId: string
  userRole: string
  initialDocs: BuildDocListItem[]
  initialTemplates: BuildDocTemplateWithVersion[]
  initialSnippets: BuildDocSnippet[]
  initialStorageSettings: BuildDocAssetStorageSettings | null
}) {
  const router = useRouter()
  const [docs, setDocs] = useState(initialDocs)
  const [templates, setTemplates] = useState(initialTemplates)
  const [snippets, setSnippets] = useState(initialSnippets)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const canWrite = userRole !== 'read_only'
  const canAdmin = ['org_admin', 'super_admin'].includes(userRole)
  const defaultTemplate = useMemo(
    () => templates.find((template) => template.isDefault && template.latestVersion) ?? templates.find((template) => template.latestVersion),
    [templates],
  )

  function refreshAll() {
    startTransition(async () => {
      const [nextDocs, nextTemplates, nextSnippets] = await Promise.all([
        listBuildDocs(orgId),
        listBuildDocTemplates(orgId),
        listBuildDocSnippets(orgId),
      ])
      setDocs(nextDocs)
      setTemplates(nextTemplates)
      setSnippets(nextSnippets)
    })
  }

  function submitTemplate(formData: FormData) {
    setError(null)
    startTransition(async () => {
      try {
        const fields = JSON.parse(String(formData.get('fields') ?? '[]'))
        const result = await createBuildDocTemplate(orgId, {
          name: String(formData.get('name') ?? ''),
          description: String(formData.get('description') ?? ''),
          isDefault: formData.get('isDefault') === 'on',
          layout: { accentColor: String(formData.get('accentColor') || '#2563eb') },
          fields,
        })
        if ('error' in result) setError(result.error)
        else refreshAll()
      } catch {
        setError('Template fields must be valid JSON')
      }
    })
  }

  function submitSnippet(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const tags = String(formData.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
      const result = await createBuildDocSnippet(orgId, {
        title: String(formData.get('title') ?? ''),
        body: String(formData.get('body') ?? ''),
        category: String(formData.get('category') || 'general'),
        tags,
      })
      if ('error' in result) setError(result.error)
      else refreshAll()
    })
  }

  function submitDoc(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const templateVersionId = String(formData.get('templateVersionId') || defaultTemplate?.latestVersion?.id || '')
      const template = templates.find((item) => item.latestVersion?.id === templateVersionId)
      const fieldValues: Record<string, unknown> = {}
      for (const field of template?.latestVersion?.fields ?? []) {
        const value = formData.get(`field-${field.id}`)
        fieldValues[field.id] = field.type === 'boolean' ? value === 'on' : String(value ?? '')
      }
      const result = await createBuildDoc(orgId, {
        title: String(formData.get('title') ?? ''),
        templateVersionId,
        hostName: String(formData.get('hostName') ?? ''),
        customerName: String(formData.get('customerName') ?? ''),
        projectName: String(formData.get('projectName') ?? ''),
        fieldValues,
      })
      if ('error' in result) setError(result.error)
      else router.push(`/build-docs/${result.data.id}`)
    })
  }

  function submitStorage(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const provider = String(formData.get('provider')) as BuildDocStorageSettingsConfig['provider']
      const config: BuildDocStorageSettingsConfig = provider === 's3'
        ? {
            provider: 's3',
            s3: {
              region: String(formData.get('region') ?? ''),
              bucket: String(formData.get('bucket') ?? ''),
              endpoint: String(formData.get('endpoint') || '') || undefined,
              forcePathStyle: formData.get('forcePathStyle') === 'on',
              accessKeyId: String(formData.get('accessKeyId') || '') || undefined,
              secretAccessKey: String(formData.get('secretAccessKey') || '') || undefined,
            },
          }
        : {
            provider: 'filesystem',
            filesystem: { rootPath: String(formData.get('rootPath') || '') || undefined },
          }
      const result = await saveBuildDocAssetStorageSettings(orgId, config)
      if ('error' in result) setError(result.error)
      else refreshAll()
    })
  }

  function runSearch() {
    startTransition(async () => {
      setDocs(await searchBuildDocs(orgId, query))
    })
  }

  const selectedTemplate = defaultTemplate?.latestVersion

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="build-docs-heading">Build Docs</h1>
          <p className="text-muted-foreground mt-1">
            Create VM build records from organisation templates, reusable snippets, screenshots, and structured sections.
          </p>
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

      <Tabs defaultValue="docs">
        <TabsList>
          <TabsTrigger value="docs"><FileText className="size-4 mr-2" />Documents</TabsTrigger>
          <TabsTrigger value="snippets"><Scissors className="size-4 mr-2" />Snippets</TabsTrigger>
          {canAdmin && <TabsTrigger value="templates"><Settings className="size-4 mr-2" />Templates</TabsTrigger>}
          {canAdmin && <TabsTrigger value="storage"><Upload className="size-4 mr-2" />Storage</TabsTrigger>}
        </TabsList>

        <TabsContent value="docs" className="space-y-4">
          <div className="flex gap-2">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all build docs" data-testid="build-doc-search" />
            <Button variant="outline" onClick={runSearch} disabled={pending} data-testid="build-doc-search-submit"><Search className="size-4" /></Button>
          </div>

          {canWrite && selectedTemplate && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New build doc</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={submitDoc} className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" name="title" placeholder="Ubuntu VM build - prod-web-01" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="templateVersionId">Template</Label>
                    <select id="templateVersionId" name="templateVersionId" className="h-9 rounded-md border bg-background px-3 text-sm">
                      {templates.filter((template) => template.latestVersion).map((template) => (
                        <option key={template.id} value={template.latestVersion!.id}>{template.name} v{template.currentVersion}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hostName">Host</Label>
                    <Input id="hostName" name="hostName" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customerName">Customer</Label>
                    <Input id="customerName" name="customerName" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="projectName">Project</Label>
                    <Input id="projectName" name="projectName" />
                  </div>
                  {selectedTemplate.fields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`field-${field.id}`}>{field.label}{field.required ? ' *' : ''}</Label>
                      {field.type === 'boolean' ? (
                        <input id={`field-${field.id}`} name={`field-${field.id}`} type="checkbox" className="block size-4" />
                      ) : (
                        <Input id={`field-${field.id}`} name={`field-${field.id}`} required={field.required} />
                      )}
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <Button type="submit" disabled={pending}><Plus className="size-4 mr-2" />Create build doc</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sections</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id} data-testid={`build-doc-row-${doc.id}`}>
                    <TableCell>
                      <Link href={`/build-docs/${doc.id}`} className="font-medium hover:underline">{doc.title}</Link>
                      <p className="text-xs text-muted-foreground">{[doc.customerName, doc.projectName, doc.hostName].filter(Boolean).join(' · ')}</p>
                    </TableCell>
                    <TableCell>{doc.templateName}</TableCell>
                    <TableCell><Badge variant="outline">{doc.status}</Badge></TableCell>
                    <TableCell>{doc.sectionCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="snippets" className="space-y-4">
          {canAdmin && (
            <Card>
              <CardHeader><CardTitle className="text-base">New snippet</CardTitle></CardHeader>
              <CardContent>
                <form action={submitSnippet} className="grid gap-4">
                  <Input name="title" placeholder="Install nginx" required />
                  <Input name="category" placeholder="linux" defaultValue="general" />
                  <Input name="tags" placeholder="nginx, web, ubuntu" />
                  <Textarea name="body" placeholder="Commands and notes" rows={6} />
                  <Button type="submit" disabled={pending}>Create snippet</Button>
                </form>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {snippets.map((snippet) => (
              <Card key={snippet.id}>
                <CardHeader><CardTitle className="text-base">{snippet.title}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">{snippet.body}</p>
                  <div className="mt-3 flex gap-1 flex-wrap">{snippet.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {canAdmin && (
          <TabsContent value="templates" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">New organisation template</CardTitle></CardHeader>
              <CardContent>
                <form action={submitTemplate} className="grid gap-4">
                  <Input name="name" placeholder="Standard VM build" required />
                  <Textarea name="description" placeholder="Template purpose" rows={2} />
                  <Input name="accentColor" defaultValue="#2563eb" />
                  <label className="inline-flex items-center gap-2 text-sm"><input name="isDefault" type="checkbox" />Default template</label>
                  <Textarea name="fields" defaultValue={defaultTemplateFields()} rows={10} className="font-mono text-xs" />
                  <Button type="submit" disabled={pending}>Create template</Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canAdmin && (
          <TabsContent value="storage">
            <Card>
              <CardHeader><CardTitle className="text-base">Image storage</CardTitle></CardHeader>
              <CardContent>
                <form action={submitStorage} className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="provider">Provider</Label>
                    <select id="provider" name="provider" defaultValue={initialStorageSettings?.provider ?? 'filesystem'} className="h-9 rounded-md border bg-background px-3 text-sm">
                      <option value="filesystem">Filesystem</option>
                      <option value="s3">S3 compatible</option>
                    </select>
                  </div>
                  <Input name="rootPath" placeholder="Filesystem root path" />
                  <Input name="region" placeholder="S3 region" />
                  <Input name="bucket" placeholder="S3 bucket" />
                  <Input name="endpoint" placeholder="S3 endpoint URL" />
                  <Input name="accessKeyId" placeholder="Access key id" />
                  <Input name="secretAccessKey" placeholder="Secret access key" type="password" />
                  <label className="inline-flex items-center gap-2 text-sm"><input name="forcePathStyle" type="checkbox" />Force path-style S3 URLs</label>
                  <div className="md:col-span-2"><Button type="submit">Save storage settings</Button></div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
