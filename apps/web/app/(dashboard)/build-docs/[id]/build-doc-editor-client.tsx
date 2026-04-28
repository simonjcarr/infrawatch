'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Download, GripVertical, ImagePlus, Plus, Save, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownRenderer } from '@/components/shared/markdown-renderer'
import {
  createBuildDocSection,
  insertBuildDocSnippetAsSection,
  reorderBuildDocSections,
  updateBuildDoc,
  updateBuildDocSection,
  uploadBuildDocAsset,
  type BuildDocDetail,
} from '@/lib/actions/build-docs'
import type { BuildDocRenderModel } from '@/lib/build-docs/types'
import type { BuildDocSection, BuildDocSnippet } from '@/lib/db/schema'

function SortableSection({
  section,
  canWrite,
  children,
}: {
  section: BuildDocSection
  canWrite: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: !canWrite })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'opacity-70' : undefined}
      data-section-title={section.title}
    >
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          {canWrite && (
            <button
              type="button"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
              title="Reorder section"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          )}
          <CardTitle className="text-base">{section.title}</CardTitle>
          {section.sourceSnippetId && <Badge variant="secondary">Snippet v{section.sourceSnippetVersion}</Badge>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

export function BuildDocEditorClient({
  orgId,
  userRole,
  detail,
  renderModel,
  snippets,
}: {
  orgId: string
  userRole: string
  detail: BuildDocDetail
  renderModel: BuildDocRenderModel
  snippets: BuildDocSnippet[]
}) {
  const [doc, setDoc] = useState(detail.doc)
  const [sections, setSections] = useState(detail.sections)
  const [assets, setAssets] = useState(detail.assets)
  const [model, setModel] = useState(renderModel)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const canWrite = userRole !== 'read_only'
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function rebuildModel(nextSections = sections, nextAssets = assets) {
    setModel({
      ...model,
      doc,
      sections: nextSections.map((section, index) => ({
        ...section,
        number: index + 1,
        assets: nextAssets
          .filter((asset) => asset.sectionId === section.id)
          .map((asset) => ({
            id: asset.id,
            sectionId: asset.sectionId,
            filename: asset.filename,
            contentType: asset.contentType,
            url: `/api/build-docs/assets/${asset.id}`,
          })),
      })),
      tableOfContents: nextSections.map((section, index) => ({ id: section.id, number: index + 1, title: section.title })),
    })
  }

  function submitDoc(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const fieldValues: Record<string, unknown> = {}
      for (const field of detail.templateVersion.fields) {
        const value = formData.get(`field-${field.id}`)
        fieldValues[field.id] = field.type === 'boolean' ? value === 'on' : String(value ?? '')
      }
      const result = await updateBuildDoc(orgId, doc.id, {
        title: String(formData.get('title') ?? ''),
        status: String(formData.get('status') ?? 'draft') as typeof doc.status,
        hostName: String(formData.get('hostName') ?? ''),
        customerName: String(formData.get('customerName') ?? ''),
        projectName: String(formData.get('projectName') ?? ''),
        fieldValues,
      })
      if ('error' in result) setError(result.error)
      else {
        setDoc(result.data)
        setModel({ ...model, doc: result.data })
      }
    })
  }

  function submitNewSection(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await createBuildDocSection(orgId, doc.id, {
        title: String(formData.get('title') ?? ''),
        body: String(formData.get('body') ?? ''),
        fieldValues: {},
      })
      if ('error' in result) setError(result.error)
      else {
        const next = [...sections, result.data]
        setSections(next)
        rebuildModel(next)
      }
    })
  }

  function submitSection(section: BuildDocSection, formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await updateBuildDocSection(orgId, section.id, {
        title: String(formData.get('title') ?? ''),
        body: String(formData.get('body') ?? ''),
        fieldValues: section.fieldValues,
      })
      if ('error' in result) setError(result.error)
      else {
        const next = sections.map((item) => item.id === section.id ? result.data : item)
        setSections(next)
        rebuildModel(next)
      }
    })
  }

  function insertSnippet(snippetId: string) {
    setError(null)
    startTransition(async () => {
      const result = await insertBuildDocSnippetAsSection(orgId, doc.id, snippetId)
      if ('error' in result) setError(result.error)
      else {
        const next = [...sections, result.data]
        setSections(next)
        rebuildModel(next)
      }
    })
  }

  function uploadImage(sectionId: string, formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await uploadBuildDocAsset(orgId, doc.id, sectionId, formData)
      if ('error' in result) setError(result.error)
      else {
        const next = [...assets, result.data]
        setAssets(next)
        rebuildModel(sections, next)
      }
    })
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sections.findIndex((section) => section.id === active.id)
    const newIndex = sections.findIndex((section) => section.id === over.id)
    const next = arrayMove(sections, oldIndex, newIndex)
    setSections(next)
    rebuildModel(next)
    startTransition(async () => {
      const result = await reorderBuildDocSections(orgId, doc.id, next.map((section) => section.id))
      if ('error' in result) setError(result.error)
    })
  }

  const assetCountBySection = useMemo(() => {
    const counts = new Map<string, number>()
    for (const asset of assets) {
      if (asset.sectionId) counts.set(asset.sectionId, (counts.get(asset.sectionId) ?? 0) + 1)
    }
    return counts
  }, [assets])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/build-docs" className="text-sm text-muted-foreground hover:underline">Build Docs</Link>
          <h1 className="text-2xl font-semibold text-foreground mt-1" data-testid="build-doc-editor-heading">{doc.title}</h1>
          <p className="text-muted-foreground mt-1">
            {detail.templateVersion.name} v{detail.templateVersion.version}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={`/api/build-docs/${doc.id}/export?format=pdf`}><Download className="size-4 mr-2" />PDF</a>
          </Button>
          <Button asChild variant="outline">
            <a href={`/api/build-docs/${doc.id}/export?format=docx`}><Download className="size-4 mr-2" />Word</a>
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Document fields</CardTitle></CardHeader>
              <CardContent>
                <form action={submitDoc} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" name="title" defaultValue={doc.title} disabled={!canWrite} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <select id="status" name="status" defaultValue={doc.status} disabled={!canWrite} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <Input name="hostName" defaultValue={doc.hostName ?? ''} placeholder="Host" disabled={!canWrite} />
                  <Input name="customerName" defaultValue={doc.customerName ?? ''} placeholder="Customer" disabled={!canWrite} />
                  <Input name="projectName" defaultValue={doc.projectName ?? ''} placeholder="Project" disabled={!canWrite} />
                  {detail.templateVersion.fields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`field-${field.id}`}>{field.label}{field.required ? ' *' : ''}</Label>
                      {field.type === 'boolean' ? (
                        <input
                          id={`field-${field.id}`}
                          name={`field-${field.id}`}
                          type="checkbox"
                          defaultChecked={Boolean(doc.fieldValues[field.id])}
                          disabled={!canWrite}
                          className="block size-4"
                        />
                      ) : (
                        <Input
                          id={`field-${field.id}`}
                          name={`field-${field.id}`}
                          defaultValue={String(doc.fieldValues[field.id] ?? '')}
                          required={field.required}
                          disabled={!canWrite}
                        />
                      )}
                    </div>
                  ))}
                  {canWrite && <Button type="submit" disabled={pending}><Save className="size-4 mr-2" />Save fields</Button>}
                </form>
              </CardContent>
            </Card>

            {canWrite && (
              <Card>
                <CardHeader><CardTitle className="text-base">Add section</CardTitle></CardHeader>
                <CardContent>
                  <form action={submitNewSection} className="space-y-3">
                    <Input name="title" placeholder="Install applications" required />
                    <Textarea name="body" placeholder="Commands, decisions, and verification notes" rows={6} />
                    <Button type="submit" disabled={pending}><Plus className="size-4 mr-2" />Add section</Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {canWrite && snippets.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Insert snippet</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {snippets.map((snippet) => (
                    <Button key={snippet.id} type="button" variant="outline" className="w-full justify-start" onClick={() => insertSnippet(snippet.id)}>
                      <Scissors className="size-4 mr-2" />{snippet.title}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {sections.map((section) => (
                  <SortableSection key={section.id} section={section} canWrite={canWrite}>
                    <form action={(formData) => submitSection(section, formData)} className="space-y-3">
                      <Input name="title" defaultValue={section.title} disabled={!canWrite} required />
                      <Textarea name="body" defaultValue={section.body} rows={10} disabled={!canWrite} />
                      <div className="flex gap-2 items-center flex-wrap">
                        {canWrite && <Button type="submit" disabled={pending}><Save className="size-4 mr-2" />Save section</Button>}
                        <Badge variant="outline">{assetCountBySection.get(section.id) ?? 0} images</Badge>
                      </div>
                    </form>
                    {canWrite && (
                      <form action={(formData) => uploadImage(section.id, formData)} className="mt-4 flex items-center gap-2">
                        <Input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
                        <Button type="submit" variant="outline" disabled={pending}><ImagePlus className="size-4" /></Button>
                      </form>
                    )}
                  </SortableSection>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </TabsContent>

        <TabsContent value="preview">
          <div className="mx-auto max-w-4xl space-y-8 rounded-md border bg-background p-8 shadow-sm" data-testid="build-doc-preview">
            <header>
              <h2 className="text-3xl font-semibold text-foreground">{model.doc.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {model.template.name} v{model.template.version}
              </p>
            </header>
            <section>
              <h3 className="text-lg font-semibold mb-3">Index</h3>
              <ol className="space-y-1 text-sm">
                {model.tableOfContents.map((item) => (
                  <li key={item.id}>{item.number}. {item.title}</li>
                ))}
              </ol>
            </section>
            {model.sections.map((section) => (
              <section key={section.id} id={`section-${section.id}`} className="space-y-4">
                <h3 className="text-xl font-semibold">{section.number}. {section.title}</h3>
                <MarkdownRenderer>{section.body || 'No section content.'}</MarkdownRenderer>
                {section.assets.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {section.assets.map((asset) => (
                      <figure key={asset.id} className="rounded-md border bg-muted/20 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.url} alt={asset.filename} className="max-h-96 w-full object-contain" />
                        <figcaption className="mt-2 text-xs text-muted-foreground">{asset.filename}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
