import type {
  BuildDocAssetStorageProvider,
  BuildDocFieldValues,
  BuildDocStatus,
  BuildDocTemplateField,
  BuildDocTemplateLayout,
} from '../db/schema/index.ts'

export type BuildDocActionResult<T> = { success: true; data: T } | { error: string }

export interface BuildDocTemplateVersionInput {
  templateId: string
  version: number
  name: string
  layout: BuildDocTemplateLayout
  fields: BuildDocTemplateField[]
}

export interface BuildDocRenderInput {
  doc: {
    id: string
    title: string
    status: BuildDocStatus
    fieldValues: BuildDocFieldValues
    hostName?: string | null
    customerName?: string | null
    projectName?: string | null
    createdAt: Date
    updatedAt: Date
  }
  templateVersion: BuildDocTemplateVersionInput
  sections: Array<{
    id: string
    title: string
    body: string
    position: number
    fieldValues: BuildDocFieldValues
    sourceSnippetId?: string | null
    sourceSnippetVersion?: number | null
  }>
  assets: Array<{
    id: string
    sectionId?: string | null
    filename: string
    contentType: string
    url: string
  }>
}

export interface BuildDocRenderModel {
  doc: BuildDocRenderInput['doc']
  template: BuildDocTemplateVersionInput
  tableOfContents: Array<{ id: string; number: number; title: string }>
  sections: Array<BuildDocRenderInput['sections'][number] & {
    number: number
    assets: BuildDocRenderInput['assets']
  }>
}

export interface StoredBuildDocAsset {
  provider: BuildDocAssetStorageProvider
  storageKey: string
  checksumSha256: string
  sizeBytes: number
}
