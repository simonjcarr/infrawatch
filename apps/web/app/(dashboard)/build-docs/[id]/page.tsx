import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import {
  getBuildDoc,
  getBuildDocRenderModel,
  listBuildDocSnippets,
} from '@/lib/actions/build-docs'
import { BuildDocEditorClient } from './build-doc-editor-client'

export const metadata: Metadata = {
  title: 'Build Doc',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function BuildDocPage({ params }: Props) {
  const { id } = await params
  const session = await getRequiredSession()
  const orgId = session.user.organisationId!
  const [detail, model, snippets] = await Promise.all([
    getBuildDoc(orgId, id),
    getBuildDocRenderModel(orgId, id),
    listBuildDocSnippets(orgId),
  ])
  if (!detail || !model) notFound()

  return (
    <BuildDocEditorClient
      orgId={orgId}
      userRole={session.user.role}
      detail={detail}
      renderModel={model}
      snippets={snippets}
    />
  )
}
