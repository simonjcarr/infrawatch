import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getHost } from '@/lib/actions/agents'

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

      const interval = setInterval(async () => {
        try {
          const host = await getHost(orgId, hostId)
          if (!host) {
            send('error', { message: 'Host not found' })
            clearInterval(interval)
            controller.close()
            return
          }
          send('update', host)
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
