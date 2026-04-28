import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { organisations } from './organisations.ts'
import { users } from './auth.ts'

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const BUILD_DOC_FIELD_TYPES = ['text', 'textarea', 'date', 'boolean', 'select'] as const
export type BuildDocFieldType = (typeof BUILD_DOC_FIELD_TYPES)[number]

export const BUILD_DOC_STATUSES = ['draft', 'published', 'archived'] as const
export type BuildDocStatus = (typeof BUILD_DOC_STATUSES)[number]

export const BUILD_DOC_ASSET_STORAGE_PROVIDERS = ['filesystem', 's3'] as const
export type BuildDocAssetStorageProvider = (typeof BUILD_DOC_ASSET_STORAGE_PROVIDERS)[number]

export interface BuildDocTemplateField {
  id: string
  label: string
  type: BuildDocFieldType
  required: boolean
  options?: string[]
}

export interface BuildDocTemplateLayout {
  accentColor?: string
  logoAssetId?: string
  includeAuthor?: boolean
  includeTimestamps?: boolean
}

export type BuildDocFieldValues = Record<string, unknown>

export interface BuildDocSnippetMetadata {
  tags?: string[]
  version?: number
}

export interface BuildDocStorageSettingsConfig {
  provider: BuildDocAssetStorageProvider
  filesystem?: {
    rootPath?: string
  }
  s3?: {
    region: string
    bucket: string
    endpoint?: string
    forcePathStyle?: boolean
    accessKeyId?: string
    secretAccessKey?: string
  }
}

export interface BuildDocRevisionSnapshot {
  title: string
  status: BuildDocStatus
  fieldValues: BuildDocFieldValues
  sections: Array<{
    id: string
    title: string
    body: string
    position: number
    fieldValues: BuildDocFieldValues
  }>
}

export const buildDocTemplates = pgTable(
  'build_doc_templates',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    createdById: text('created_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    currentVersion: integer('current_version').notNull().default(1),
    layout: jsonb('layout').$type<BuildDocTemplateLayout>().notNull().default({}),
    fields: jsonb('fields').$type<BuildDocTemplateField[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('build_doc_templates_org_active_idx').on(t.organisationId, t.deletedAt, t.isActive),
    uniqueIndex('build_doc_templates_default_uidx')
      .on(t.organisationId, t.isDefault)
      .where(sql`${t.isDefault} = TRUE AND ${t.deletedAt} IS NULL`),
  ],
)

export const buildDocTemplateVersions = pgTable(
  'build_doc_template_versions',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    templateId: text('template_id').notNull().references(() => buildDocTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    layout: jsonb('layout').$type<BuildDocTemplateLayout>().notNull().default({}),
    fields: jsonb('fields').$type<BuildDocTemplateField[]>().notNull().default([]),
    createdById: text('created_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('build_doc_template_versions_template_version_uidx').on(t.templateId, t.version),
    index('build_doc_template_versions_org_idx').on(t.organisationId, t.templateId),
  ],
)

export const buildDocSnippets = pgTable(
  'build_doc_snippets',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    createdById: text('created_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    lastEditedById: text('last_edited_by_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    category: text('category').notNull().default('general'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    version: integer('version').notNull().default(1),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B') || setweight(to_tsvector('english', coalesce(category, '')), 'C')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<BuildDocSnippetMetadata>(),
  },
  (t) => [
    index('build_doc_snippets_org_updated_idx').on(t.organisationId, t.deletedAt, t.updatedAt),
    index('build_doc_snippets_search_vector_idx').using('gin', t.searchVector),
  ],
)

export const buildDocs = pgTable(
  'build_docs',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    templateVersionId: text('template_version_id')
      .notNull()
      .references(() => buildDocTemplateVersions.id, { onDelete: 'restrict' }),
    authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    lastEditedById: text('last_edited_by_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft').$type<BuildDocStatus>(),
    hostName: text('host_name'),
    customerName: text('customer_name'),
    projectName: text('project_name'),
    fieldValues: jsonb('field_values').$type<BuildDocFieldValues>().notNull().default({}),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(host_name, '')), 'B') || setweight(to_tsvector('english', coalesce(customer_name, '')), 'B') || setweight(to_tsvector('english', coalesce(project_name, '')), 'B')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('build_docs_org_updated_idx').on(t.organisationId, t.deletedAt, t.updatedAt),
    index('build_docs_template_idx').on(t.templateVersionId),
    index('build_docs_status_idx').on(t.organisationId, t.status),
    index('build_docs_search_vector_idx').using('gin', t.searchVector),
  ],
)

export const buildDocSections = pgTable(
  'build_doc_sections',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    buildDocId: text('build_doc_id').notNull().references(() => buildDocs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    position: integer('position').notNull(),
    fieldValues: jsonb('field_values').$type<BuildDocFieldValues>().notNull().default({}),
    sourceSnippetId: text('source_snippet_id').references(() => buildDocSnippets.id, { onDelete: 'set null' }),
    sourceSnippetVersion: integer('source_snippet_version'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('build_doc_sections_doc_position_idx').on(t.buildDocId, t.position),
    index('build_doc_sections_org_idx').on(t.organisationId, t.deletedAt),
    index('build_doc_sections_search_vector_idx').using('gin', t.searchVector),
  ],
)

export const buildDocAssets = pgTable(
  'build_doc_assets',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    buildDocId: text('build_doc_id').notNull().references(() => buildDocs.id, { onDelete: 'cascade' }),
    sectionId: text('section_id').references(() => buildDocSections.id, { onDelete: 'set null' }),
    uploadedById: text('uploaded_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().$type<BuildDocAssetStorageProvider>(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('build_doc_assets_doc_idx').on(t.buildDocId, t.deletedAt),
    index('build_doc_assets_section_idx').on(t.sectionId),
    uniqueIndex('build_doc_assets_storage_key_uidx').on(t.provider, t.storageKey),
  ],
)

export const buildDocRevisions = pgTable(
  'build_doc_revisions',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    buildDocId: text('build_doc_id').notNull().references(() => buildDocs.id, { onDelete: 'cascade' }),
    editorId: text('editor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').$type<BuildDocRevisionSnapshot>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('build_doc_revisions_doc_created_idx').on(t.buildDocId, t.createdAt)],
)

export const buildDocAssetStorageSettings = pgTable(
  'build_doc_asset_storage_settings',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    organisationId: text('organisation_id').notNull().references(() => organisations.id),
    updatedById: text('updated_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().$type<BuildDocAssetStorageProvider>().default('filesystem'),
    config: jsonb('config').$type<BuildDocStorageSettingsConfig>().notNull().default({ provider: 'filesystem' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('build_doc_asset_storage_settings_org_uidx').on(t.organisationId)],
)

export type BuildDocTemplate = typeof buildDocTemplates.$inferSelect
export type NewBuildDocTemplate = typeof buildDocTemplates.$inferInsert
export type BuildDocTemplateVersion = typeof buildDocTemplateVersions.$inferSelect
export type NewBuildDocTemplateVersion = typeof buildDocTemplateVersions.$inferInsert
export type BuildDocSnippet = typeof buildDocSnippets.$inferSelect
export type NewBuildDocSnippet = typeof buildDocSnippets.$inferInsert
export type BuildDoc = typeof buildDocs.$inferSelect
export type NewBuildDoc = typeof buildDocs.$inferInsert
export type BuildDocSection = typeof buildDocSections.$inferSelect
export type NewBuildDocSection = typeof buildDocSections.$inferInsert
export type BuildDocAsset = typeof buildDocAssets.$inferSelect
export type NewBuildDocAsset = typeof buildDocAssets.$inferInsert
export type BuildDocRevision = typeof buildDocRevisions.$inferSelect
export type NewBuildDocRevision = typeof buildDocRevisions.$inferInsert
export type BuildDocAssetStorageSettings = typeof buildDocAssetStorageSettings.$inferSelect
export type NewBuildDocAssetStorageSettings = typeof buildDocAssetStorageSettings.$inferInsert
