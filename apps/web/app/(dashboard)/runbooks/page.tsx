import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Runbooks',
}

export default function RunbooksPage() {
  redirect('/build-docs')
}
