import { redirect } from 'next/navigation'

export default async function GlobalAlertsSettingsPage() {
  redirect('/settings/monitoring')
}
