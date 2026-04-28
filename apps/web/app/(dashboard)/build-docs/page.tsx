import type { Metadata } from 'next'
import { getRequiredSession } from '@/lib/auth/session'
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
  const orgId = session.user.organisationId!
  const [docs, templates, snippets, storageSettings] = await Promise.all([
    listBuildDocs(orgId),
    listBuildDocTemplates(orgId),
    listBuildDocSnippets(orgId),
    ['org_admin', 'super_admin'].includes(session.user.role) ? getBuildDocAssetStorageSettings(orgId) : Promise.resolve(null),
  ])

  return (
    <BuildDocsClient
      orgId={orgId}
      userRole={session.user.role}
      initialDocs={docs}
      initialTemplates={templates}
      initialSnippets={snippets}
      initialStorageSettings={storageSettings}
    />
  )
}
