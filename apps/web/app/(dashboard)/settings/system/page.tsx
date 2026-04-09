import type { Metadata } from 'next'
import { SystemHealthClient } from './system-client'

export const metadata: Metadata = {
  title: 'System Health',
}

export default function SystemHealthPage() {
  return <SystemHealthClient />
}
