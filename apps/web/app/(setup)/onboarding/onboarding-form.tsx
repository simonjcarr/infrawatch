'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { createOrganisation } from '@/lib/actions/organisations'
import { useSession } from '@/lib/auth/client'

const orgSchema = z.object({
  name: z.string().min(2, 'Organisation name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
})

type OrgValues = z.infer<typeof orgSchema>

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
}

export function OnboardingForm() {
  const router = useRouter()
  const { data: session } = useSession()
  const [serverError, setServerError] = useState<string | null>(null)
  const [slugPreview, setSlugPreview] = useState<string>('')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
  })

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value
    setValue('name', name)
    const slug = toSlug(name)
    setValue('slug', slug)
    setSlugPreview(slug)
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (values: OrgValues) => {
      const userId = session?.user?.id
      if (!userId) throw new Error('Not authenticated')
      return createOrganisation(userId, values)
    },
    onSuccess: (result) => {
      if ('error' in result) {
        setServerError(result.error)
        return
      }
      router.push('/dashboard')
      router.refresh()
    },
    onError: (err) => {
      setServerError(err instanceof Error ? err.message : 'An unexpected error occurred')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your organisation</CardTitle>
        <CardDescription>
          This is the primary workspace for your team. You can invite members after setup.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit((values) => mutate(values))}>
        <CardContent className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="name">Organisation name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Acme Engineering"
              {...register('name')}
              onChange={handleNameChange}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">URL slug</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">ct-ops.local/</span>
              <Input
                id="slug"
                type="text"
                placeholder="acme-engineering"
                {...register('slug')}
                onChange={(e) => setSlugPreview(e.target.value)}
              />
            </div>
            {errors.slug && (
              <p className="text-xs text-destructive">{errors.slug.message}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {slugPreview
              ? `Your organisation will be identified as "${slugPreview}"`
              : 'The slug is auto-generated from your organisation name and can be changed.'}
          </p>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create organisation'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
