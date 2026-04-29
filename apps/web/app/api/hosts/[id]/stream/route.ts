import { NextRequest } from 'next/server'
import { getHost } from '@/lib/actions/agents'
import { getChecksWithHistory } from '@/lib/actions/checks'
import { listNotesForHost } from '@/lib/actions/notes'
import { ApiAuthError, getApiOrgSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session
  try {
    session = await getApiOrgSession()
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return new Response(err.message, { status: err.status })
    }
    throw err
  }

  const { id: hostId } = await params
  const orgId = session.user.organisationId

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      const initial = await getHost(orgId, hostId)
      if (!initial) {
        send('error', { message: 'Host not found' })
        controller.close()
        return
      }
      send('update', initial)
      send('checks', await getChecksWithHistory(orgId, hostId))
      send('notes', await listNotesForHost(orgId, hostId))

      // Notes change infrequently compared to metrics — poll them every third
      // tick (≈15s) to keep the DB load down. The counter lives in closure so
      // we avoid an extra setInterval timer just for the slower cadence.
      let tick = 0
      const interval = setInterval(async () => {
        tick += 1
        try {
          const host = await getHost(orgId, hostId)
          if (!host) {
            send('error', { message: 'Host not found' })
            clearInterval(interval)
            controller.close()
            return
          }
          send('update', host)
          send('checks', await getChecksWithHistory(orgId, hostId))
          if (tick % 3 === 0) {
            send('notes', await listNotesForHost(orgId, hostId))
          }
        } catch {
          // transient DB error — skip this tick
        }
      }, 5_000)

      request.signal.addEventListener('abort', () => {
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
