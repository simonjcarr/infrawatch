'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  createBuildDoc as createBuildDocCore,
  createBuildDocSection as createBuildDocSectionCore,
  createBuildDocSnippet as createBuildDocSnippetCore,
  createBuildDocTemplate as createBuildDocTemplateCore,
  getBuildDoc as getBuildDocCore,
  getBuildDocAssetBytes as getBuildDocAssetBytesCore,
  getBuildDocAssetStorageSettings as getBuildDocAssetStorageSettingsCore,
  getBuildDocRenderModel as getBuildDocRenderModelCore,
  insertBuildDocSnippetAsSection as insertBuildDocSnippetAsSectionCore,
  listBuildDocs as listBuildDocsCore,
  listBuildDocSnippets as listBuildDocSnippetsCore,
  listBuildDocTemplates as listBuildDocTemplatesCore,
  reorderBuildDocSections as reorderBuildDocSectionsCore,
  saveBuildDocAssetStorageSettings as saveBuildDocAssetStorageSettingsCore,
  searchBuildDocs as searchBuildDocsCore,
  searchBuildDocSnippets as searchBuildDocSnippetsCore,
  updateBuildDoc as updateBuildDocCore,
  updateBuildDocSection as updateBuildDocSectionCore,
  uploadBuildDocAsset as uploadBuildDocAssetCore,
  type BuildDocDetail,
  type BuildDocListItem,
  type BuildDocTemplateWithVersion,
} from './build-docs-core'

export type {
  BuildDocDetail,
  BuildDocListItem,
  BuildDocTemplateWithVersion,
} from './build-docs-core'

export async function listBuildDocTemplates(): Promise<Awaited<ReturnType<typeof listBuildDocTemplatesCore>>> {
  const session = await getRequiredSession()
  return listBuildDocTemplatesCore(resolveCurrentActionScope(session))
}

export async function createBuildDocTemplate(
  input: Parameters<typeof createBuildDocTemplateCore>[1],
): Promise<Awaited<ReturnType<typeof createBuildDocTemplateCore>>> {
  const session = await getRequiredSession()
  return createBuildDocTemplateCore(resolveCurrentActionScope(session), input)
}

export async function listBuildDocSnippets(): Promise<Awaited<ReturnType<typeof listBuildDocSnippetsCore>>> {
  const session = await getRequiredSession()
  return listBuildDocSnippetsCore(resolveCurrentActionScope(session))
}

export async function createBuildDocSnippet(
  input: Parameters<typeof createBuildDocSnippetCore>[1],
): Promise<Awaited<ReturnType<typeof createBuildDocSnippetCore>>> {
  const session = await getRequiredSession()
  return createBuildDocSnippetCore(resolveCurrentActionScope(session), input)
}

export async function searchBuildDocSnippets(
  q: string,
): Promise<Awaited<ReturnType<typeof searchBuildDocSnippetsCore>>> {
  const session = await getRequiredSession()
  return searchBuildDocSnippetsCore(resolveCurrentActionScope(session), q)
}

export async function listBuildDocs(): Promise<BuildDocListItem[]> {
  const session = await getRequiredSession()
  return listBuildDocsCore(resolveCurrentActionScope(session))
}

export async function searchBuildDocs(
  q: string,
  filter?: Parameters<typeof searchBuildDocsCore>[2],
): Promise<BuildDocListItem[]> {
  const session = await getRequiredSession()
  return searchBuildDocsCore(resolveCurrentActionScope(session), q, filter)
}

export async function createBuildDoc(
  input: Parameters<typeof createBuildDocCore>[1],
): Promise<Awaited<ReturnType<typeof createBuildDocCore>>> {
  const session = await getRequiredSession()
  return createBuildDocCore(resolveCurrentActionScope(session), input)
}

export async function getBuildDoc(
  docId: string,
): Promise<BuildDocDetail | null> {
  const session = await getRequiredSession()
  return getBuildDocCore(resolveCurrentActionScope(session), docId)
}

export async function updateBuildDoc(
  docId: string,
  input: Parameters<typeof updateBuildDocCore>[2],
): Promise<Awaited<ReturnType<typeof updateBuildDocCore>>> {
  const session = await getRequiredSession()
  return updateBuildDocCore(resolveCurrentActionScope(session), docId, input)
}

export async function createBuildDocSection(
  docId: string,
  input: Parameters<typeof createBuildDocSectionCore>[2],
): Promise<Awaited<ReturnType<typeof createBuildDocSectionCore>>> {
  const session = await getRequiredSession()
  return createBuildDocSectionCore(resolveCurrentActionScope(session), docId, input)
}

export async function updateBuildDocSection(
  sectionId: string,
  input: Parameters<typeof updateBuildDocSectionCore>[2],
): Promise<Awaited<ReturnType<typeof updateBuildDocSectionCore>>> {
  const session = await getRequiredSession()
  return updateBuildDocSectionCore(resolveCurrentActionScope(session), sectionId, input)
}

export async function reorderBuildDocSections(
  docId: string,
  sectionIds: string[],
): Promise<Awaited<ReturnType<typeof reorderBuildDocSectionsCore>>> {
  const session = await getRequiredSession()
  return reorderBuildDocSectionsCore(resolveCurrentActionScope(session), docId, sectionIds)
}

export async function insertBuildDocSnippetAsSection(
  docId: string,
  snippetId: string,
): Promise<Awaited<ReturnType<typeof insertBuildDocSnippetAsSectionCore>>> {
  const session = await getRequiredSession()
  return insertBuildDocSnippetAsSectionCore(resolveCurrentActionScope(session), docId, snippetId)
}

export async function uploadBuildDocAsset(
  docId: string,
  sectionId: string | null,
  formData: FormData,
): Promise<Awaited<ReturnType<typeof uploadBuildDocAssetCore>>> {
  const session = await getRequiredSession()
  return uploadBuildDocAssetCore(resolveCurrentActionScope(session), docId, sectionId, formData)
}

export async function getBuildDocAssetBytes(
  assetId: string,
): Promise<Awaited<ReturnType<typeof getBuildDocAssetBytesCore>>> {
  const session = await getRequiredSession()
  return getBuildDocAssetBytesCore(resolveCurrentActionScope(session), assetId)
}

export async function getBuildDocRenderModel(
  docId: string,
): Promise<Awaited<ReturnType<typeof getBuildDocRenderModelCore>>> {
  const session = await getRequiredSession()
  return getBuildDocRenderModelCore(resolveCurrentActionScope(session), docId)
}

export async function getBuildDocAssetStorageSettings(): Promise<Awaited<ReturnType<typeof getBuildDocAssetStorageSettingsCore>>> {
  const session = await getRequiredSession()
  return getBuildDocAssetStorageSettingsCore(resolveCurrentActionScope(session))
}

export async function saveBuildDocAssetStorageSettings(
  config: Parameters<typeof saveBuildDocAssetStorageSettingsCore>[1],
): Promise<Awaited<ReturnType<typeof saveBuildDocAssetStorageSettingsCore>>> {
  const session = await getRequiredSession()
  return saveBuildDocAssetStorageSettingsCore(resolveCurrentActionScope(session), config)
}
