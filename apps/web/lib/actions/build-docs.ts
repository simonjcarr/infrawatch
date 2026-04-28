'use server'

import { logError } from '@/lib/logging'
import { db } from '@/lib/db'
import {
  auditEvents,
  buildDocAssetStorageSettings,
  buildDocAssets,
  buildDocs,
  buildDocRevisions,
  buildDocSections,
  buildDocSnippets,
  buildDocTemplateVersions,
  buildDocTemplates,
  type BuildDoc,
  type BuildDocAsset,
  type BuildDocAssetStorageSettings,
  type BuildDocFieldValues,
  type BuildDocSection,
  type BuildDocSnippet,
  type BuildDocStorageSettingsConfig,
  type BuildDocTemplate,
  type BuildDocTemplateLayout,
  type BuildDocTemplateVersion,
} from '@/lib/db/schema'
import { requireOrgAccess, requireOrgAdminAccess } from '@/lib/actions/action-auth'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBuildDocAdministration, canReadBuildDocs, canWriteBuildDocs } from '@/lib/build-docs/permissions'
import {
  createSnippetSnapshot,
  normaliseSectionOrder,
  parseStorageSettings,
  parseTemplateFields,
  templateLayoutSchema,
  validateAssetUpload,
  validateTemplateFieldValues,
} from '@/lib/build-docs/validation'
import { buildRenderModel } from '@/lib/build-docs/render-model'
import type { BuildDocRenderModel } from '@/lib/build-docs/types'
import { createBuildDocAssetStorage } from '@/lib/build-docs/storage'

type ActionResult<T> = { success: true; data: T } | { error: string }

export interface BuildDocListItem extends BuildDoc {
  templateName: string
  sectionCount: number
}

export interface BuildDocDetail {
  doc: BuildDoc
  templateVersion: BuildDocTemplateVersion
  sections: BuildDocSection[]
  assets: BuildDocAsset[]
}

export interface BuildDocTemplateWithVersion extends BuildDocTemplate {
  latestVersion: BuildDocTemplateVersion | null
}

const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).default(''),
  isDefault: z.boolean().default(false),
  layout: templateLayoutSchema.default({}),
  fields: z.unknown().default([]),
})

const snippetInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50_000).default(''),
  category: z.string().trim().min(1).max(80).default('general'),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
})

const docInputSchema = z.object({
  title: z.string().trim().min(1).max(220),
  templateVersionId: z.string().min(1),
  hostName: z.string().trim().max(200).optional(),
  customerName: z.string().trim().max(200).optional(),
  projectName: z.string().trim().max(200).optional(),
  fieldValues: z.record(z.string(), z.unknown()).default({}),
})

const docUpdateSchema = z.object({
  title: z.string().trim().min(1).max(220).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  hostName: z.string().trim().max(200).nullable().optional(),
  customerName: z.string().trim().max(200).nullable().optional(),
  projectName: z.string().trim().max(200).nullable().optional(),
  fieldValues: z.record(z.string(), z.unknown()).optional(),
})

const sectionInputSchema = z.object({
  title: z.string().trim().min(1).max(220),
  body: z.string().max(100_000).default(''),
  fieldValues: z.record(z.string(), z.unknown()).default({}),
})

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? fallback
  if (error instanceof Error) return error.message
  return fallback
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

async function getAssetStorageConfig(orgId: string): Promise<BuildDocStorageSettingsConfig | null> {
  const settings = await db.query.buildDocAssetStorageSettings.findFirst({
    where: eq(buildDocAssetStorageSettings.organisationId, orgId),
  })
  return settings?.config ?? null
}

type BuildDocTx = Pick<typeof db, 'insert' | 'query' | 'update'>

async function writeAudit(tx: Pick<typeof db, 'insert'>, input: {
  organisationId: string
  actorUserId: string
  action: string
  targetType: string
  targetId?: string | null
  summary: string
  metadata?: Record<string, unknown>
}) {
  await tx.insert(auditEvents).values(input)
}

async function getDocForWrite(orgId: string, docId: string) {
  return db.query.buildDocs.findFirst({
    where: and(eq(buildDocs.id, docId), eq(buildDocs.organisationId, orgId), isNull(buildDocs.deletedAt)),
  })
}

async function writeDocRevision(tx: BuildDocTx, orgId: string, docId: string, editorId: string) {
  const [doc, sections] = await Promise.all([
    tx.query.buildDocs.findFirst({
      where: and(eq(buildDocs.id, docId), eq(buildDocs.organisationId, orgId)),
    }),
    tx.query.buildDocSections.findMany({
      where: and(eq(buildDocSections.buildDocId, docId), eq(buildDocSections.organisationId, orgId), isNull(buildDocSections.deletedAt)),
      orderBy: asc(buildDocSections.position),
    }),
  ])
  if (!doc) return
  await tx.insert(buildDocRevisions).values({
    organisationId: orgId,
    buildDocId: docId,
    editorId,
    snapshot: {
      title: doc.title,
      status: doc.status,
      fieldValues: doc.fieldValues,
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        body: section.body,
        position: section.position,
        fieldValues: section.fieldValues,
      })),
    },
  })
}

export async function listBuildDocTemplates(orgId: string): Promise<BuildDocTemplateWithVersion[]> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return []

  const templates = await db.query.buildDocTemplates.findMany({
    where: and(eq(buildDocTemplates.organisationId, orgId), isNull(buildDocTemplates.deletedAt)),
    orderBy: [desc(buildDocTemplates.isDefault), asc(buildDocTemplates.name)],
  })
  const versions = templates.length
    ? await db.query.buildDocTemplateVersions.findMany({
        where: inArray(buildDocTemplateVersions.templateId, templates.map((template) => template.id)),
      })
    : []
  return templates.map((template) => ({
    ...template,
    latestVersion: versions.find((version) => version.templateId === template.id && version.version === template.currentVersion) ?? null,
  }))
}

export async function createBuildDocTemplate(
  orgId: string,
  input: z.input<typeof templateInputSchema>,
): Promise<ActionResult<BuildDocTemplateWithVersion>> {
  const session = await requireOrgAdminAccess(orgId)
  if (!canManageBuildDocAdministration(session.user)) return { error: 'You do not have permission to perform this action' }

  try {
    const parsed = templateInputSchema.parse(input)
    const fields = parseTemplateFields(parsed.fields)
    const created = await db.transaction(async (tx) => {
      if (parsed.isDefault) {
        await tx
          .update(buildDocTemplates)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(buildDocTemplates.organisationId, orgId), eq(buildDocTemplates.isDefault, true)))
      }
      const [template] = await tx.insert(buildDocTemplates).values({
        organisationId: orgId,
        createdById: session.user.id,
        name: parsed.name,
        description: parsed.description,
        isDefault: parsed.isDefault,
        layout: parsed.layout as BuildDocTemplateLayout,
        fields,
      }).returning()
      if (!template) throw new Error('Failed to create template')
      const [version] = await tx.insert(buildDocTemplateVersions).values({
        organisationId: orgId,
        templateId: template.id,
        version: 1,
        name: template.name,
        description: template.description,
        layout: template.layout,
        fields: template.fields,
        createdById: session.user.id,
      }).returning()
      if (!version) throw new Error('Failed to create template version')
      await writeAudit(tx, {
        organisationId: orgId,
        actorUserId: session.user.id,
        action: 'build_doc_template.create',
        targetType: 'build_doc_template',
        targetId: template.id,
        summary: `Created build doc template ${template.name}`,
      })
      return { ...template, latestVersion: version }
    })
    return { success: true, data: created }
  } catch (err) {
    logError('Failed to create build doc template:', err)
    return { error: errorMessage(err, 'Failed to create template') }
  }
}

export async function listBuildDocSnippets(orgId: string): Promise<BuildDocSnippet[]> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return []
  return db.query.buildDocSnippets.findMany({
    where: and(eq(buildDocSnippets.organisationId, orgId), isNull(buildDocSnippets.deletedAt)),
    orderBy: [desc(buildDocSnippets.updatedAt)],
    limit: 500,
  })
}

export async function createBuildDocSnippet(
  orgId: string,
  input: z.input<typeof snippetInputSchema>,
): Promise<ActionResult<BuildDocSnippet>> {
  const session = await requireOrgAdminAccess(orgId)
  try {
    const parsed = snippetInputSchema.parse(input)
    const [snippet] = await db.insert(buildDocSnippets).values({
      organisationId: orgId,
      createdById: session.user.id,
      title: parsed.title,
      body: parsed.body,
      category: parsed.category,
      tags: parsed.tags,
      metadata: { tags: parsed.tags, version: 1 },
    }).returning()
    if (!snippet) return { error: 'Failed to create snippet' }
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: session.user.id,
      action: 'build_doc_snippet.create',
      targetType: 'build_doc_snippet',
      targetId: snippet.id,
      summary: `Created build doc snippet ${snippet.title}`,
    })
    return { success: true, data: snippet }
  } catch (err) {
    logError('Failed to create build doc snippet:', err)
    return { error: errorMessage(err, 'Failed to create snippet') }
  }
}

export async function searchBuildDocSnippets(orgId: string, q: string): Promise<BuildDocSnippet[]> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return []
  const trimmed = q.trim()
  if (!trimmed) return listBuildDocSnippets(orgId)
  try {
    const rows = await db.execute(sql`
      SELECT *
      FROM build_doc_snippets
      WHERE organisation_id = ${orgId}
        AND deleted_at IS NULL
        AND search_vector @@ websearch_to_tsquery('english', ${trimmed})
      ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${trimmed})) DESC,
               updated_at DESC
      LIMIT 50
    `)
    return rowsToSnippets(rows)
  } catch {
    const like = `%${escapeLikePattern(trimmed)}%`
    const rows = await db.execute(sql`
      SELECT *
      FROM build_doc_snippets
      WHERE organisation_id = ${orgId}
        AND deleted_at IS NULL
        AND (title ILIKE ${like} ESCAPE '\\' OR body ILIKE ${like} ESCAPE '\\')
      ORDER BY updated_at DESC
      LIMIT 50
    `)
    return rowsToSnippets(rows)
  }
}

export async function listBuildDocs(orgId: string): Promise<BuildDocListItem[]> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return []
  const rows = await db.execute(sql`
    SELECT d.*, tv.name AS template_name, cast(count(s.id) AS int) AS section_count
    FROM build_docs d
    JOIN build_doc_template_versions tv ON tv.id = d.template_version_id
    LEFT JOIN build_doc_sections s ON s.build_doc_id = d.id AND s.deleted_at IS NULL
    WHERE d.organisation_id = ${orgId}
      AND d.deleted_at IS NULL
    GROUP BY d.id, tv.name
    ORDER BY d.updated_at DESC
    LIMIT 500
  `)
  return rowsToBuildDocListItems(rows)
}

export async function searchBuildDocs(
  orgId: string,
  q: string,
  filter: { docId?: string; templateVersionId?: string } = {},
): Promise<BuildDocListItem[]> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return []
  const trimmed = q.trim()
  if (!trimmed && !filter.docId && !filter.templateVersionId) return listBuildDocs(orgId)
  const query = trimmed || '*'
  try {
    const rows = await db.execute(sql`
      SELECT d.*, tv.name AS template_name, cast(count(DISTINCT s.id) AS int) AS section_count
      FROM build_docs d
      JOIN build_doc_template_versions tv ON tv.id = d.template_version_id
      LEFT JOIN build_doc_sections s ON s.build_doc_id = d.id AND s.deleted_at IS NULL
      WHERE d.organisation_id = ${orgId}
        AND d.deleted_at IS NULL
        AND (${filter.docId ?? null}::text IS NULL OR d.id = ${filter.docId ?? null})
        AND (${filter.templateVersionId ?? null}::text IS NULL OR d.template_version_id = ${filter.templateVersionId ?? null})
        AND (
          ${trimmed ? true : false} = false
          OR d.search_vector @@ websearch_to_tsquery('english', ${query})
          OR s.search_vector @@ websearch_to_tsquery('english', ${query})
        )
      GROUP BY d.id, tv.name
      ORDER BY d.updated_at DESC
      LIMIT 50
    `)
    return rowsToBuildDocListItems(rows)
  } catch {
    const like = `%${escapeLikePattern(trimmed)}%`
    const rows = await db.execute(sql`
      SELECT d.*, tv.name AS template_name, cast(count(DISTINCT s.id) AS int) AS section_count
      FROM build_docs d
      JOIN build_doc_template_versions tv ON tv.id = d.template_version_id
      LEFT JOIN build_doc_sections s ON s.build_doc_id = d.id AND s.deleted_at IS NULL
      WHERE d.organisation_id = ${orgId}
        AND d.deleted_at IS NULL
        AND (${filter.docId ?? null}::text IS NULL OR d.id = ${filter.docId ?? null})
        AND (${filter.templateVersionId ?? null}::text IS NULL OR d.template_version_id = ${filter.templateVersionId ?? null})
        AND (${trimmed ? true : false} = false OR d.title ILIKE ${like} ESCAPE '\\' OR s.title ILIKE ${like} ESCAPE '\\' OR s.body ILIKE ${like} ESCAPE '\\')
      GROUP BY d.id, tv.name
      ORDER BY d.updated_at DESC
      LIMIT 50
    `)
    return rowsToBuildDocListItems(rows)
  }
}

export async function createBuildDoc(
  orgId: string,
  input: z.input<typeof docInputSchema>,
): Promise<ActionResult<BuildDoc>> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }

  try {
    const parsed = docInputSchema.parse(input)
    const templateVersion = await db.query.buildDocTemplateVersions.findFirst({
      where: and(eq(buildDocTemplateVersions.id, parsed.templateVersionId), eq(buildDocTemplateVersions.organisationId, orgId)),
    })
    if (!templateVersion) return { error: 'Template not found' }
    const fieldResult = validateTemplateFieldValues(templateVersion.fields, parsed.fieldValues)
    if (!fieldResult.success) return { error: fieldResult.error }

    const created = await db.transaction(async (tx) => {
      const [doc] = await tx.insert(buildDocs).values({
        organisationId: orgId,
        templateVersionId: templateVersion.id,
        authorId: session.user.id,
        title: parsed.title,
        hostName: parsed.hostName || null,
        customerName: parsed.customerName || null,
        projectName: parsed.projectName || null,
        fieldValues: fieldResult.values,
      }).returning()
      if (!doc) throw new Error('Failed to create build doc')
      await writeDocRevision(tx, orgId, doc.id, session.user.id)
      return doc
    })
    return { success: true, data: created }
  } catch (err) {
    logError('Failed to create build doc:', err)
    return { error: errorMessage(err, 'Failed to create build doc') }
  }
}

export async function getBuildDoc(orgId: string, docId: string): Promise<BuildDocDetail | null> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return null
  const doc = await db.query.buildDocs.findFirst({
    where: and(eq(buildDocs.id, docId), eq(buildDocs.organisationId, orgId), isNull(buildDocs.deletedAt)),
  })
  if (!doc) return null
  const [templateVersion, sections, assets] = await Promise.all([
    db.query.buildDocTemplateVersions.findFirst({
      where: and(eq(buildDocTemplateVersions.id, doc.templateVersionId), eq(buildDocTemplateVersions.organisationId, orgId)),
    }),
    db.query.buildDocSections.findMany({
      where: and(eq(buildDocSections.buildDocId, docId), eq(buildDocSections.organisationId, orgId), isNull(buildDocSections.deletedAt)),
      orderBy: asc(buildDocSections.position),
    }),
    db.query.buildDocAssets.findMany({
      where: and(eq(buildDocAssets.buildDocId, docId), eq(buildDocAssets.organisationId, orgId), isNull(buildDocAssets.deletedAt)),
      orderBy: asc(buildDocAssets.createdAt),
    }),
  ])
  if (!templateVersion) return null
  return { doc, templateVersion, sections, assets }
}

export async function updateBuildDoc(
  orgId: string,
  docId: string,
  input: z.input<typeof docUpdateSchema>,
): Promise<ActionResult<BuildDoc>> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }
  try {
    const parsed = docUpdateSchema.parse(input)
    const existing = await getDocForWrite(orgId, docId)
    if (!existing) return { error: 'Build doc not found' }
    const templateVersion = await db.query.buildDocTemplateVersions.findFirst({
      where: eq(buildDocTemplateVersions.id, existing.templateVersionId),
    })
    if (!templateVersion) return { error: 'Template not found' }
    let nextFieldValues = existing.fieldValues
    if (parsed.fieldValues !== undefined) {
      const fieldResult = validateTemplateFieldValues(templateVersion.fields, parsed.fieldValues)
      if (!fieldResult.success) return { error: fieldResult.error }
      nextFieldValues = fieldResult.values
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(buildDocs).set({
        title: parsed.title ?? existing.title,
        status: parsed.status ?? existing.status,
        hostName: parsed.hostName === undefined ? existing.hostName : parsed.hostName,
        customerName: parsed.customerName === undefined ? existing.customerName : parsed.customerName,
        projectName: parsed.projectName === undefined ? existing.projectName : parsed.projectName,
        fieldValues: nextFieldValues,
        lastEditedById: session.user.id,
        updatedAt: new Date(),
      }).where(and(eq(buildDocs.id, docId), eq(buildDocs.organisationId, orgId))).returning()
      if (!row) throw new Error('Build doc not found')
      await writeDocRevision(tx, orgId, docId, session.user.id)
      return row
    })
    return { success: true, data: updated }
  } catch (err) {
    logError('Failed to update build doc:', err)
    return { error: errorMessage(err, 'Failed to update build doc') }
  }
}

export async function createBuildDocSection(
  orgId: string,
  docId: string,
  input: z.input<typeof sectionInputSchema>,
): Promise<ActionResult<BuildDocSection>> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }
  try {
    const parsed = sectionInputSchema.parse(input)
    const doc = await getDocForWrite(orgId, docId)
    if (!doc) return { error: 'Build doc not found' }
    const maxRows = await db.select({ max: sql<number>`coalesce(max(${buildDocSections.position}), 0)` })
      .from(buildDocSections)
      .where(and(eq(buildDocSections.buildDocId, docId), eq(buildDocSections.organisationId, orgId), isNull(buildDocSections.deletedAt)))
    const position = (maxRows[0]?.max ?? 0) + 1000
    const created = await db.transaction(async (tx) => {
      const [section] = await tx.insert(buildDocSections).values({
        organisationId: orgId,
        buildDocId: docId,
        title: parsed.title,
        body: parsed.body,
        fieldValues: parsed.fieldValues,
        position,
      }).returning()
      if (!section) throw new Error('Failed to create section')
      await tx.update(buildDocs).set({ updatedAt: new Date(), lastEditedById: session.user.id }).where(eq(buildDocs.id, docId))
      await writeDocRevision(tx, orgId, docId, session.user.id)
      return section
    })
    return { success: true, data: created }
  } catch (err) {
    logError('Failed to create build doc section:', err)
    return { error: errorMessage(err, 'Failed to create section') }
  }
}

export async function updateBuildDocSection(
  orgId: string,
  sectionId: string,
  input: z.input<typeof sectionInputSchema>,
): Promise<ActionResult<BuildDocSection>> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }
  try {
    const parsed = sectionInputSchema.parse(input)
    const existing = await db.query.buildDocSections.findFirst({
      where: and(eq(buildDocSections.id, sectionId), eq(buildDocSections.organisationId, orgId), isNull(buildDocSections.deletedAt)),
    })
    if (!existing) return { error: 'Section not found' }
    const updated = await db.transaction(async (tx) => {
      const [section] = await tx.update(buildDocSections).set({
        title: parsed.title,
        body: parsed.body,
        fieldValues: parsed.fieldValues,
        updatedAt: new Date(),
      }).where(and(eq(buildDocSections.id, sectionId), eq(buildDocSections.organisationId, orgId))).returning()
      if (!section) throw new Error('Section not found')
      await tx.update(buildDocs).set({ updatedAt: new Date(), lastEditedById: session.user.id }).where(eq(buildDocs.id, existing.buildDocId))
      await writeDocRevision(tx, orgId, existing.buildDocId, session.user.id)
      return section
    })
    return { success: true, data: updated }
  } catch (err) {
    logError('Failed to update build doc section:', err)
    return { error: errorMessage(err, 'Failed to update section') }
  }
}

export async function reorderBuildDocSections(
  orgId: string,
  docId: string,
  orderedSectionIds: string[],
): Promise<{ success: true } | { error: string }> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }
  try {
    const doc = await getDocForWrite(orgId, docId)
    if (!doc) return { error: 'Build doc not found' }
    const sections = await db.query.buildDocSections.findMany({
      where: and(eq(buildDocSections.buildDocId, docId), eq(buildDocSections.organisationId, orgId), isNull(buildDocSections.deletedAt)),
      columns: { id: true },
    })
    const existingIds = new Set(sections.map((section) => section.id))
    if (orderedSectionIds.length !== sections.length || orderedSectionIds.some((id) => !existingIds.has(id))) {
      return { error: 'Section order does not match this document' }
    }
    await db.transaction(async (tx) => {
      for (const item of normaliseSectionOrder(orderedSectionIds)) {
        await tx.update(buildDocSections).set({ position: item.position, updatedAt: new Date() }).where(eq(buildDocSections.id, item.id))
      }
      await tx.update(buildDocs).set({ updatedAt: new Date(), lastEditedById: session.user.id }).where(eq(buildDocs.id, docId))
      await writeDocRevision(tx, orgId, docId, session.user.id)
    })
    return { success: true }
  } catch (err) {
    logError('Failed to reorder build doc sections:', err)
    return { error: 'Failed to reorder sections' }
  }
}

export async function insertBuildDocSnippetAsSection(
  orgId: string,
  docId: string,
  snippetId: string,
): Promise<ActionResult<BuildDocSection>> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }
  try {
    const [doc, snippet] = await Promise.all([
      getDocForWrite(orgId, docId),
      db.query.buildDocSnippets.findFirst({
        where: and(eq(buildDocSnippets.id, snippetId), eq(buildDocSnippets.organisationId, orgId), isNull(buildDocSnippets.deletedAt)),
      }),
    ])
    if (!doc) return { error: 'Build doc not found' }
    if (!snippet) return { error: 'Snippet not found' }
    const snapshot = createSnippetSnapshot(snippet)
    return createBuildDocSection(orgId, docId, {
      title: snapshot.title,
      body: snapshot.body,
      fieldValues: {},
    }).then(async (result) => {
      if ('error' in result) return result
      const [section] = await db.update(buildDocSections).set({
        sourceSnippetId: snapshot.sourceSnippetId,
        sourceSnippetVersion: snapshot.sourceSnippetVersion,
      }).where(eq(buildDocSections.id, result.data.id)).returning()
      return { success: true as const, data: section ?? result.data }
    })
  } catch (err) {
    logError('Failed to insert build doc snippet:', err)
    return { error: 'Failed to insert snippet' }
  }
}

export async function uploadBuildDocAsset(
  orgId: string,
  docId: string,
  sectionId: string | null,
  formData: FormData,
): Promise<ActionResult<BuildDocAsset>> {
  const session = await requireOrgAccess(orgId)
  if (!canWriteBuildDocs(session.user)) return { error: 'You do not have permission to perform this action' }
  try {
    const doc = await getDocForWrite(orgId, docId)
    if (!doc) return { error: 'Build doc not found' }
    if (sectionId) {
      const section = await db.query.buildDocSections.findFirst({
        where: and(eq(buildDocSections.id, sectionId), eq(buildDocSections.buildDocId, docId), eq(buildDocSections.organisationId, orgId), isNull(buildDocSections.deletedAt)),
      })
      if (!section) return { error: 'Section not found' }
    }
    const file = formData.get('file')
    if (!(file instanceof File)) return { error: 'Choose an image to upload' }
    const bytes = Buffer.from(await file.arrayBuffer())
    const validation = validateAssetUpload({ contentType: file.type, size: bytes.length })
    if (!validation.success) return { error: validation.error }
    const settings = await getAssetStorageConfig(orgId)
    const storage = createBuildDocAssetStorage(settings)
    const stored = await storage.put({
      organisationId: orgId,
      buildDocId: docId,
      filename: file.name,
      contentType: file.type,
      bytes,
    })
    const [asset] = await db.insert(buildDocAssets).values({
      organisationId: orgId,
      buildDocId: docId,
      sectionId,
      uploadedById: session.user.id,
      provider: stored.provider,
      storageKey: stored.storageKey,
      filename: file.name,
      contentType: file.type,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
    }).returning()
    if (!asset) return { error: 'Failed to save uploaded image' }
    return { success: true, data: asset }
  } catch (err) {
    logError('Failed to upload build doc asset:', err)
    return { error: 'Failed to upload image' }
  }
}

export async function getBuildDocAssetBytes(orgId: string, assetId: string): Promise<{ asset: BuildDocAsset; bytes: Buffer } | null> {
  const session = await requireOrgAccess(orgId)
  if (!canReadBuildDocs(session.user)) return null
  const asset = await db.query.buildDocAssets.findFirst({
    where: and(eq(buildDocAssets.id, assetId), eq(buildDocAssets.organisationId, orgId), isNull(buildDocAssets.deletedAt)),
  })
  if (!asset) return null
  const settings = await getAssetStorageConfig(orgId)
  const storage = createBuildDocAssetStorage(settings)
  const bytes = await storage.get(asset.storageKey)
  return { asset, bytes }
}

export async function getBuildDocRenderModel(orgId: string, docId: string): Promise<BuildDocRenderModel | null> {
  const detail = await getBuildDoc(orgId, docId)
  if (!detail) return null
  return buildRenderModel({
    doc: detail.doc,
    templateVersion: {
      templateId: detail.templateVersion.templateId,
      version: detail.templateVersion.version,
      name: detail.templateVersion.name,
      layout: detail.templateVersion.layout,
      fields: detail.templateVersion.fields,
    },
    sections: detail.sections,
    assets: detail.assets.map((asset) => ({
      id: asset.id,
      sectionId: asset.sectionId,
      filename: asset.filename,
      contentType: asset.contentType,
      url: `/api/build-docs/assets/${asset.id}?orgId=${encodeURIComponent(orgId)}`,
    })),
  })
}

export async function getBuildDocAssetStorageSettings(orgId: string): Promise<BuildDocAssetStorageSettings | null> {
  await requireOrgAdminAccess(orgId)
  return (await db.query.buildDocAssetStorageSettings.findFirst({
    where: eq(buildDocAssetStorageSettings.organisationId, orgId),
  })) ?? null
}

export async function saveBuildDocAssetStorageSettings(
  orgId: string,
  input: unknown,
): Promise<ActionResult<BuildDocAssetStorageSettings>> {
  const session = await requireOrgAdminAccess(orgId)
  try {
    const config = parseStorageSettings(input)
    const [settings] = await db.insert(buildDocAssetStorageSettings).values({
      organisationId: orgId,
      updatedById: session.user.id,
      provider: config.provider,
      config,
    }).onConflictDoUpdate({
      target: buildDocAssetStorageSettings.organisationId,
      set: {
        updatedById: session.user.id,
        provider: config.provider,
        config,
        updatedAt: new Date(),
      },
    }).returning()
    if (!settings) return { error: 'Failed to save storage settings' }
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: session.user.id,
      action: 'build_doc_asset_storage.update',
      targetType: 'build_doc_asset_storage_settings',
      targetId: settings.id,
      summary: `Updated build doc asset storage to ${config.provider}`,
      metadata: { provider: config.provider },
    })
    return { success: true, data: settings }
  } catch (err) {
    logError('Failed to save build doc storage settings:', err)
    return { error: errorMessage(err, 'Failed to save storage settings') }
  }
}

function rowsToSnippets(rows: unknown): BuildDocSnippet[] {
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    organisationId: row.organisation_id as string,
    createdById: row.created_by_id as string,
    lastEditedById: (row.last_edited_by_id as string | null) ?? null,
    title: row.title as string,
    body: row.body as string,
    category: row.category as string,
    tags: (row.tags as string[] | null) ?? [],
    version: row.version as number,
    searchVector: (row.search_vector as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    deletedAt: (row.deleted_at as Date | null) ?? null,
    metadata: (row.metadata as BuildDocSnippet['metadata']) ?? null,
  }))
}

function rowsToBuildDocListItems(rows: unknown): BuildDocListItem[] {
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    organisationId: row.organisation_id as string,
    templateVersionId: row.template_version_id as string,
    authorId: row.author_id as string,
    lastEditedById: (row.last_edited_by_id as string | null) ?? null,
    title: row.title as string,
    status: row.status as BuildDoc['status'],
    hostName: (row.host_name as string | null) ?? null,
    customerName: (row.customer_name as string | null) ?? null,
    projectName: (row.project_name as string | null) ?? null,
    fieldValues: (row.field_values as BuildDocFieldValues | null) ?? {},
    searchVector: (row.search_vector as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    deletedAt: (row.deleted_at as Date | null) ?? null,
    templateName: row.template_name as string,
    sectionCount: row.section_count as number,
  }))
}
