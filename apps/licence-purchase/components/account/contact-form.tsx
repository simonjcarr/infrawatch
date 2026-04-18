'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pencil } from 'lucide-react'
import { upsertContact } from '@/lib/actions/contacts'
import type { ContactRole } from '@/lib/db/schema'

type Contact = { name: string; email: string; phone: string }

export function ContactForm({
  role,
  title,
  description,
  initial,
}: {
  role: ContactRole
  title: string
  description: string
  initial?: Partial<Contact>
}) {
  const seed: Contact | null = initial?.name && initial?.email
    ? { name: initial.name, email: initial.email, phone: initial.phone ?? '' }
    : null

  const [current, setCurrent] = useState<Contact | null>(seed)
  const [editing, setEditing] = useState<boolean>(!seed)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(data: FormData) {
    setError(null)
    const next: Contact = {
      name: String(data.get('name') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim(),
    }
    start(async () => {
      try {
        await upsertContact({
          role,
          name: next.name,
          email: next.email,
          phone: next.phone || undefined,
        })
        setCurrent(next)
        setEditing(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to save contact')
      }
    })
  }

  if (!editing && current) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Name</dt>
              <dd className="text-foreground">{current.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Email</dt>
              <dd className="text-foreground break-all">{current.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Phone</dt>
              <dd className="text-foreground">{current.phone || '—'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${role}-name`}>Name</Label>
            <Input id={`${role}-name`} name="name" defaultValue={current?.name} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${role}-email`}>Email</Label>
            <Input id={`${role}-email`} name="email" type="email" defaultValue={current?.email} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${role}-phone`}>Phone (optional)</Label>
            <Input id={`${role}-phone`} name="phone" type="tel" defaultValue={current?.phone} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} size="sm">
              {pending ? 'Saving…' : current ? 'Update contact' : 'Save contact'}
            </Button>
            {current ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
