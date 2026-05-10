import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
import {
  listBuildDocs,
  listBuildDocSnippets,
  listBuildDocTemplates,
  getBuildDocAssetStorageSettings,
} from '@/lib/actions/build-docs'
import { BuildDocsClient } from './build-docs-client'

export const metadata: Metadata = {
  title: 'Build Docs',
}

export default async function BuildDocsPage() {
  const session = await getRequiredSession()
  if (!canAccessTooling(session.user)) redirect('/dashboard')
  const [docs, templates, snippets, storageSettings] = await Promise.all([
    listBuildDocs(),
    listBuildDocTemplates(),
    listBuildDocSnippets(),
    ['org_admin', 'super_admin'].includes(session.user.role) ? getBuildDocAssetStorageSettings() : Promise.resolve(null),
  ])

  return (
    <BuildDocsClient
      userRole={session.user.role}
      initialDocs={docs}
      initialTemplates={templates}
      initialSnippets={snippets}
      initialStorageSettings={storageSettings}
    />
  )
}
