import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getHost } from '@/lib/actions/agents'
import { getChecksWithHistory } from '@/lib/actions/checks'
import { listNotesForHost } from '@/lib/actions/notes'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  if (!user?.organisationId) return new Response('Forbidden', { status: 403 })

  const { id: hostId } = await params
  const orgId = user.organisationId

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
