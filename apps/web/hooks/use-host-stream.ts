'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { HostWithAgent } from '@/lib/actions/agents'

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

    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [hostId, orgId, queryClient])
}
