import { NextRequest, NextResponse } from 'next/server'
import { Client, type SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { hosts, users } from '@/lib/db/schema'
import path from 'node:path'

export const runtime = 'nodejs'

const TransferFieldsSchema = z.object({
  hostId: z.string().min(1),
  username: z.string().min(1).max(128).regex(/^[^\s:]+$/, 'Username cannot contain whitespace or ":"'),
  password: z.string().min(1).max(4096),
  directory: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes('\0'), 'Directory path is invalid')
    .refine((value) => value.trim().startsWith('/'), 'Enter an absolute directory path'),
  fileName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._-]+\.zip$/, 'Bundle filename must be a zip filename'),
})

function formValue(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function getFormFile(form: FormData): File | null {
  const value = form.get('bundle')
  if (value && typeof value === 'object' && 'arrayBuffer' in value && 'size' in value) {
    return value as File
  }
  return null
}

function connectSsh(options: { host: string; username: string; password: string }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const cleanup = () => {
      client.off('ready', onReady)
      client.off('error', onError)
    }
    const onReady = () => {
      cleanup()
      resolve(client)
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    client.once('ready', onReady)
    client.once('error', onError)
    client.connect({
      host: options.host,
      port: 22,
      username: options.username,
      password: options.password,
      readyTimeout: 30_000,
      keepaliveInterval: 10_000,
    })
  })
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err: Error | undefined, sftp: SFTPWrapper | undefined) => {
      if (err) reject(err)
      else if (sftp) resolve(sftp)
      else reject(new Error('Failed to open SFTP session'))
    })
  })
}

function isMissingSftpError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | { code?: number } | null)?.code
  return code === 'ENOENT' || code === 2
}

function stat(sftp: SFTPWrapper, remotePath: string): Promise<{ isDirectory: () => boolean } | null> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err: Error | undefined, stats: { isDirectory: () => boolean } | undefined) => {
      if (!err) {
        resolve(stats ?? null)
        return
      }
      if (isMissingSftpError(err)) {
        resolve(null)
        return
      }
      reject(err)
    })
  })
}

function mkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, async (err: Error | null | undefined) => {
      if (!err) {
        resolve()
        return
      }
      try {
        const stats = await stat(sftp, remotePath)
        if (stats?.isDirectory()) resolve()
        else reject(err)
      } catch {
        reject(err)
      }
    })
  })
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, directory: string) {
  const normalized = path.posix.normalize(directory)
  const parts = normalized.split('/').filter(Boolean)
  let current = normalized.startsWith('/') ? '/' : ''

  for (const part of parts) {
    current = current === '/' ? `/${part}` : path.posix.join(current, part)
    const stats = await stat(sftp, current)
    if (!stats) await mkdir(sftp, current)
    else if (!stats.isDirectory()) throw new Error(`${current} exists but is not a directory`)
  }
}

function writeFile(sftp: SFTPWrapper, remotePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, data, (err: Error | null | undefined) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  if (!user?.organisationId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'Invalid transfer request' }, { status: 400 })
  }

  const bundle = getFormFile(form)
  if (!bundle || bundle.size === 0) {
    return NextResponse.json({ error: 'Bundle zip is required' }, { status: 400 })
  }

  const parsed = TransferFieldsSchema.safeParse({
    hostId: formValue(form, 'hostId'),
    username: formValue(form, 'username').trim(),
    password: formValue(form, 'password'),
    directory: formValue(form, 'directory').trim(),
    fileName: formValue(form, 'fileName').trim(),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid transfer request' },
      { status: 400 },
    )
  }

  const host = await db.query.hosts.findFirst({
    where: and(
      eq(hosts.id, parsed.data.hostId),
      eq(hosts.organisationId, user.organisationId),
      isNull(hosts.deletedAt),
    ),
  })
  if (!host) {
    return NextResponse.json({ error: 'Host not found' }, { status: 404 })
  }

  const connectHost = host.hostname
  const directory = path.posix.normalize(parsed.data.directory)
  const remotePath = path.posix.join(directory, parsed.data.fileName)
  let client: Client | null = null

  try {
    const data = Buffer.from(await bundle.arrayBuffer())
    client = await connectSsh({
      host: connectHost,
      username: parsed.data.username,
      password: parsed.data.password,
    })
    const sftp = await openSftp(client)
    await ensureRemoteDirectory(sftp, directory)
    await writeFile(sftp, remotePath, data)

    return NextResponse.json({
      ok: true,
      host: connectHost,
      path: remotePath,
      bytes: data.byteLength,
    })
  } catch (err) {
    console.error('Bundle transfer failed:', err)
    const message = err instanceof Error && err.message ? err.message : 'Transfer failed'
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    client?.end()
  }
}
