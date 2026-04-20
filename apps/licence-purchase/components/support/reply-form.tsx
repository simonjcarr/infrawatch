'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { postCustomerMessage } from '@/lib/actions/support'
import { FilePicker, type PendingAttachment } from './file-picker'

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])

  function onSubmit(data: FormData) {
    setError(null)
    const body = String(data.get('body') ?? '').trim()
    if (!body) return
    start(async () => {
      try {
        await postCustomerMessage({
          ticketId,
          body,
          attachmentIds: attachments.map((a) => a.id),
        })
        const form = document.getElementById(`reply-${ticketId}`) as HTMLFormElement | null
        form?.reset()
        setAttachments([])
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to send message')
      }
    })
  }

  return (
    <form id={`reply-${ticketId}`} action={onSubmit} className="grid gap-3">
      <textarea
        name="body"
        required
        minLength={1}
        maxLength={20000}
        rows={5}
        placeholder="Write your reply…"
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <FilePicker ticketId={ticketId} attachments={attachments} onChange={setAttachments} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  )
}
