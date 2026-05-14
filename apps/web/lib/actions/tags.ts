'use server'

import { getRequiredSession } from '@/lib/auth/session'
import { resolveCurrentActionScope } from './action-scope'
import {
  assignTagsToResource as assignTagsToResourceCore,
  getInstanceDefaultTags as getInstanceDefaultTagsCore,
  listResourceTags as listResourceTagsCore,
  mergeTagLayers as mergeTagLayersCore,
  removeTagFromResource as removeTagFromResourceCore,
  replaceResourceTags as replaceResourceTagsCore,
  searchTags as searchTagsCore,
  updateInstanceDefaultTags as updateInstanceDefaultTagsCore,
  type TagAssignment,
} from './tags-core'

export type { TagAssignment } from './tags-core'

export const mergeTagLayers = mergeTagLayersCore

export async function searchTags(
  query: string,
  opts?: { key?: string; limit?: number },
): Promise<import('@/lib/db/schema').Tag[]> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return searchTagsCore(currentScope, query, opts)
}

export async function assignTagsToResource(
  scopeId: string,
  resourceType: string,
  resourceId: string,
  pairs: import('@/lib/db/schema').TagPair[],
): Promise<{ success: true } | { error: string }> {
  return assignTagsToResourceCore(scopeId, resourceType, resourceId, pairs)
}

export async function removeTagFromResource(
  scopeId: string,
  resourceTagId: string,
): Promise<{ success: true } | { error: string }> {
  return removeTagFromResourceCore(scopeId, resourceTagId)
}

export async function replaceResourceTags(
  resourceType: string,
  resourceId: string,
  pairs: import('@/lib/db/schema').TagPair[],
): Promise<{ success: true } | { error: string }> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return replaceResourceTagsCore(currentScope, resourceType, resourceId, pairs)
}

export async function listResourceTags(
  resourceType: string,
  resourceId: string,
): Promise<TagAssignment[]> {
  const session = await getRequiredSession()
  const currentScope = resolveCurrentActionScope(session)
  return listResourceTagsCore(currentScope, resourceType, resourceId)
}

export async function getInstanceDefaultTags(scopeId: string): Promise<import('@/lib/db/schema').TagPair[]> {
  return getInstanceDefaultTagsCore(scopeId)
}

export async function updateInstanceDefaultTags(
  scopeId: string,
  pairs: import('@/lib/db/schema').TagPair[],
): Promise<{ success: true } | { error: string }> {
  return updateInstanceDefaultTagsCore(scopeId, pairs)
}
