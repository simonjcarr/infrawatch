import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Check your email',
}

type CheckEmailPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function CheckEmailPage({ searchParams }: CheckEmailPageProps) {
  const params = await searchParams
  const email = readParam(params.email)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a verification link{email ? ` to ${email}` : ''}. You need to verify your
          address before CT-Ops will sign you in.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        After you open the link, CT-Ops will continue to the next step automatically.
      </CardContent>
      <CardFooter>
        <Link href="/login" className="text-sm text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  )
}
