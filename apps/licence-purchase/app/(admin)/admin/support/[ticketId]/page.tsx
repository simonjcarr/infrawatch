import { notFound } from 'next/navigation'
import Link from 'next/link'
import { MessageBubble } from '@/components/support/message-bubble'
import { AdminTicketControls } from '@/components/support/admin-ticket-controls'
import { AdminReplyForm } from '@/components/support/admin-reply-form'
import { TicketAutoRefresh } from '@/components/support/ticket-auto-refresh'
import { getAdminTicket } from '@/lib/actions/support'

export const metadata = { title: 'Ticket · Admin' }

export default async function AdminTicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>
}) {
  const { ticketId } = await params
  const data = await getAdminTicket(ticketId)
  if (!data) notFound()
  const { ticket, messages, orgName } = data

  const isClosed = ticket.status === 'closed'

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <TicketAutoRefresh enabled={!isClosed} />
      <div className="mb-4 text-sm">
        <Link href="/admin/support" className="text-muted-foreground hover:text-foreground">
          ← All tickets
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {orgName ? `${orgName} · ` : ''}Opened {new Date(ticket.createdAt).toLocaleString()}
          </p>
        </div>
        <AdminTicketControls
          ticketId={ticket.id}
          status={ticket.status}
          aiPaused={ticket.aiPaused}
        />
      </div>

      {ticket.aiFlagReason ? (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <strong>AI flag:</strong> {ticket.aiFlagReason}
        </div>
      ) : null}

      <div className="mb-6 grid gap-3">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            author={m.author as 'customer' | 'ai' | 'staff'}
            authorLabel={
              m.author === 'ai'
                ? `Assistant${m.aiModelId ? ` (${m.aiModelId})` : ''}`
                : m.author === 'staff'
                  ? `Staff · ${m.authorName ?? 'Unknown'}`
                  : `Customer · ${m.authorName ?? 'Unknown'}`
            }
            body={m.body}
            createdAt={m.createdAt}
          />
        ))}
      </div>

      <AdminReplyForm ticketId={ticket.id} />
    </div>
  )
}
