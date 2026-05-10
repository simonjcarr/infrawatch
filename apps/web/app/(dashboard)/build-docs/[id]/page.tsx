import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getRequiredSession } from '@/lib/auth/session'
import { canAccessTooling } from '@/lib/auth/tooling'
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
  if (!canAccessTooling(session.user)) redirect('/dashboard')
  const [detail, model, snippets] = await Promise.all([
    getBuildDoc(id),
    getBuildDocRenderModel(id),
    listBuildDocSnippets(),
  ])
  if (!detail || !model) notFound()

  return (
    <BuildDocEditorClient
      userRole={session.user.role}
      detail={detail}
      renderModel={model}
      snippets={snippets}
    />
  )
}
