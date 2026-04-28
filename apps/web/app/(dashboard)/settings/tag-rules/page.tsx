import { redirect } from 'next/navigation'

export default async function TagRulesPage() {
  redirect('/settings/agents/tags')
}
