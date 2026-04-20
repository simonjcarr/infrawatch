'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTicket } from '@/lib/actions/support'
import { FilePicker, type PendingAttachment } from './file-picker'

export function NewTicketForm() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])

  function onSubmit(data: FormData) {
    setError(null)
    const subject = String(data.get('subject') ?? '').trim()
    const body = String(data.get('body') ?? '').trim()
    start(async () => {
      try {
        const { id } = await createTicket({
          subject,
          body,
          attachmentIds: attachments.map((a) => a.id),
        })
        router.push(`/support/${id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to create ticket')
      }
    })
  }

  return (
    <form action={onSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" required minLength={3} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="body">Message</Label>
        <textarea
          id="body"
          name="body"
          required
          minLength={1}
          maxLength={20000}
          rows={10}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Attachments</Label>
        <FilePicker attachments={attachments} onChange={setAttachments} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit ticket'}
        </Button>
      </div>
    </form>
  )
}
