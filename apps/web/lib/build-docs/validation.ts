import { z } from 'zod'
import {
  BUILD_DOC_ASSET_STORAGE_PROVIDERS,
  BUILD_DOC_FIELD_TYPES,
  type BuildDocFieldValues,
  type BuildDocTemplateField,
  type BuildDocStorageSettingsConfig,
} from '../db/schema/index.ts'

export const MAX_BUILD_DOC_IMAGE_BYTES = 10 * 1024 * 1024
export const BUILD_DOC_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export const templateFieldSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'Use letters, numbers, hyphens, and underscores'),
  label: z.string().trim().min(1).max(120),
  type: z.enum(BUILD_DOC_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
})

export const templateLayoutSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoAssetId: z.string().min(1).max(160).optional(),
  includeAuthor: z.boolean().optional(),
  includeTimestamps: z.boolean().optional(),
})

export const storageSettingsSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('filesystem'),
    filesystem: z.object({ rootPath: z.string().min(1).max(500).optional() }).optional(),
  }),
  z.object({
    provider: z.literal('s3'),
    s3: z.object({
      region: z.string().min(1).max(80),
      bucket: z.string().min(3).max(255),
      endpoint: z.string().url().optional(),
      forcePathStyle: z.boolean().optional(),
      accessKeyId: z.string().min(1).max(300).optional(),
      secretAccessKey: z.string().min(1).max(300).optional(),
    }),
  }),
])

export function parseTemplateFields(input: unknown): BuildDocTemplateField[] {
  const fields = z.array(templateFieldSchema).max(40).parse(input)
  const ids = new Set<string>()
  for (const field of fields) {
    if (ids.has(field.id)) {
      throw new Error(`Duplicate template field: ${field.id}`)
    }
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      throw new Error(`Select field "${field.label}" needs at least one option`)
    }
    ids.add(field.id)
  }
  return fields
}

export function parseStorageSettings(input: unknown): BuildDocStorageSettingsConfig {
  return storageSettingsSchema.parse(input)
}

function validateFieldValue(field: BuildDocTemplateField, value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    if (field.required) throw new Error(`${field.label} is required`)
    return undefined
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') throw new Error(`${field.label} must be text`)
      if (value.length > 5000) throw new Error(`${field.label} is too long`)
      return value
    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new Error(`${field.label} must be a valid date`)
      }
      return value
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`${field.label} must be true or false`)
      return value
    case 'select':
      if (typeof value !== 'string' || !field.options?.includes(value)) {
        throw new Error(`${field.label} must be one of the configured options`)
      }
      return value
    default:
      throw new Error(`${field.label} has an unsupported field type`)
  }
}

export function validateTemplateFieldValues(
  fields: BuildDocTemplateField[],
  values: BuildDocFieldValues,
): { success: true; values: BuildDocFieldValues } | { success: false; error: string } {
  try {
    const clean: BuildDocFieldValues = {}
    for (const field of fields) {
      const value = validateFieldValue(field, values[field.id])
      if (value !== undefined) clean[field.id] = value
    }
    return { success: true, values: clean }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid field values' }
  }
}

export function normaliseSectionOrder(ids: string[]): Array<{ id: string; position: number }> {
  return ids.map((id, index) => ({ id, position: (index + 1) * 1000 }))
}

export function createSnippetSnapshot(snippet: {
  id: string
  version: number
  title: string
  body: string
}) {
  return {
    sourceSnippetId: snippet.id,
    sourceSnippetVersion: snippet.version,
    title: snippet.title,
    body: snippet.body,
  }
}

export function validateAssetUpload(input: {
  contentType: string
  size: number
}): { success: true } | { success: false; error: string } {
  if (!BUILD_DOC_IMAGE_CONTENT_TYPES.includes(input.contentType as (typeof BUILD_DOC_IMAGE_CONTENT_TYPES)[number])) {
    return { success: false, error: 'Unsupported image type' }
  }
  if (input.size <= 0) {
    return { success: false, error: 'Image is empty' }
  }
  if (input.size > MAX_BUILD_DOC_IMAGE_BYTES) {
    return { success: false, error: 'Image is too large' }
  }
  return { success: true }
}

export function isSupportedStorageProvider(provider: string): boolean {
  return BUILD_DOC_ASSET_STORAGE_PROVIDERS.includes(provider as never)
}
