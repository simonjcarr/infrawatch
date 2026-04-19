'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { HostWithAgent } from '@/lib/actions/agents'
import type { CheckWithHistory } from '@/lib/actions/checks'
import type { ResolvedNote } from '@/lib/actions/notes-resolver'

export function useHostStream({ hostId, orgId }: { hostId: string; orgId: string }) {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    esRef.current?.close()

    const es = new EventSource(`/api/hosts/${hostId}/stream`)
    esRef.current = es

    es.addEventListener('update', (e) => {
      try {
        const host: HostWithAgent = JSON.parse(e.data)
        queryClient.setQueryData(['host', orgId, hostId], host)
      } catch {
        // malformed JSON — ignore
      }
    })

    es.addEventListener('checks', (e) => {
      try {
        const checks: CheckWithHistory[] = JSON.parse(e.data)
        queryClient.setQueryData(['checks-history', orgId, hostId], checks)
      } catch {
        // malformed JSON — ignore
      }
    })

    es.addEventListener('notes', (e) => {
      try {
        // Dates arrive serialised as ISO strings; revive so date-fns keeps
        // working without per-caller parsing.
        const raw: Array<Omit<ResolvedNote, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
          createdAt: string
          updatedAt: string
          deletedAt: string | null
        }> = JSON.parse(e.data)
        const notes: ResolvedNote[] = raw.map((n) => ({
          ...n,
          createdAt: new Date(n.createdAt),
          updatedAt: new Date(n.updatedAt),
          deletedAt: n.deletedAt ? new Date(n.deletedAt) : null,
        }))
        queryClient.setQueryData(['notes-for-host', orgId, hostId], notes)
      } catch {
        // malformed JSON — ignore
      }
    })

    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [hostId, orgId, queryClient])
}
