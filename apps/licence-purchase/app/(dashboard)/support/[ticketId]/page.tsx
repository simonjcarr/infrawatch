import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MessageBubble } from '@/components/support/message-bubble'
import { ReplyForm } from '@/components/support/reply-form'
import { TicketAutoRefresh } from '@/components/support/ticket-auto-refresh'
import { getMyTicket } from '@/lib/actions/support'

export const metadata = { title: 'Ticket' }

export default async function CustomerTicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>
}) {
  const { ticketId } = await params
  const data = await getMyTicket(ticketId)
  if (!data) notFound()
  const { ticket, messages } = data
  const isClosed = ticket.status === 'closed'

  return (
    <>
      <TicketAutoRefresh enabled={!isClosed} />
      <div className="mb-4 text-sm">
        <Link href="/support" className="text-muted-foreground hover:text-foreground">
          ← Back to tickets
        </Link>
      </div>
      <PageHeader title={ticket.subject} description={`Opened ${new Date(ticket.createdAt).toLocaleString()}`} />

      {ticket.aiPaused && !isClosed ? (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          This ticket is being handled by a member of our team. AI replies are paused.
        </div>
      ) : null}

      <div className="mb-6 grid gap-3">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            author={m.author as 'customer' | 'ai' | 'staff'}
            authorLabel={m.author === 'customer' ? 'You' : m.author === 'ai' ? 'Assistant' : 'Support team'}
            body={m.body}
            createdAt={m.createdAt}
          />
        ))}
      </div>

      {!isClosed ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reply</CardTitle>
          </CardHeader>
          <CardContent>
            <ReplyForm ticketId={ticket.id} />
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          This ticket is closed. Open a new one if you need more help.
        </div>
      )}
    </>
  )
}
