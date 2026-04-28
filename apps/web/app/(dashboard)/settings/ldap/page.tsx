import { redirect } from 'next/navigation'

export default async function LdapSettingsPage() {
  redirect('/settings/integrations')
}
