import { NextRequest, NextResponse } from 'next/server'
import archiver from 'archiver'
import { Client, type SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { hosts, users } from '@/lib/db/schema'
import { resolveWarUrl } from '@/lib/jenkins/update-center'

export const runtime = 'nodejs'
export const maxDuration = 900

const GitLabPackageTargetSchema = z.enum([
  'ubuntu-noble',
  'ubuntu-jammy',
  'ubuntu-focal',
  'debian-bookworm',
  'debian-bullseye',
  'el-9',
  'el-8',
])

const GitLabEditionSchema = z.enum(['ee', 'ce'])
const GitLabArchSchema = z.enum(['amd64', 'arm64', 'x86_64', 'aarch64'])
const GitLabVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/)

const GitLabTargets: Record<z.infer<typeof GitLabPackageTargetSchema>, {
  kind: 'deb' | 'rpm'
  distro: string
  release: string
  label: string
  arches: readonly string[]
}> = {
  'ubuntu-noble': { kind: 'deb', distro: 'ubuntu', release: 'noble', label: 'Ubuntu 24.04 Noble', arches: ['amd64', 'arm64'] },
  'ubuntu-jammy': { kind: 'deb', distro: 'ubuntu', release: 'jammy', label: 'Ubuntu 22.04 Jammy', arches: ['amd64', 'arm64'] },
  'ubuntu-focal': { kind: 'deb', distro: 'ubuntu', release: 'focal', label: 'Ubuntu 20.04 Focal', arches: ['amd64', 'arm64'] },
  'debian-bookworm': { kind: 'deb', distro: 'debian', release: 'bookworm', label: 'Debian 12 Bookworm', arches: ['amd64', 'arm64'] },
  'debian-bullseye': { kind: 'deb', distro: 'debian', release: 'bullseye', label: 'Debian 11 Bullseye', arches: ['amd64', 'arm64'] },
  'el-9': { kind: 'rpm', distro: 'el', release: '9', label: 'RHEL/Rocky/Alma 9', arches: ['x86_64', 'aarch64'] },
  'el-8': { kind: 'rpm', distro: 'el', release: '8', label: 'RHEL/Rocky/Alma 8', arches: ['x86_64', 'aarch64'] },
}

const GitLabStepSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(['required-stop', 'target']),
  version: GitLabVersionSchema,
  majorMinor: z.string().regex(/^\d+\.\d+$/),
  sourceVersion: GitLabVersionSchema,
  conditional: z.boolean(),
  note: z.string().max(1000).nullable(),
  packageName: z.string().regex(/^gitlab-(ee|ce)$/),
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sizeLabel: z.string().max(50).nullable(),
  status: z.literal('available'),
})

const GitLabBundleSchema = z.object({
  kind: z.literal('gitlab'),
  currentVersion: GitLabVersionSchema,
  targetVersion: GitLabVersionSchema,
  edition: GitLabEditionSchema,
  packageTarget: z.object({
    key: GitLabPackageTargetSchema,
    label: z.string().min(1).max(100),
    arch: GitLabArchSchema,
    kind: z.enum(['deb', 'rpm']),
  }),
  generatedAt: z.string().min(1),
  sources: z.object({
    upgradePath: z.string().url(),
    packages: z.string().url(),
  }),
  steps: z.array(GitLabStepSchema).min(1).max(50),
})

const JenkinsPluginSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i).max(100),
  requested: z.string().max(200),
  status: z.enum(['compatible', 'java-incompatible', 'not-found', 'core-incompatible']),
  version: z.string().regex(/^[0-9][0-9A-Za-z.+_-]*$/).max(100).optional(),
  requiredCore: z.string().max(50).optional(),
  minimumJavaVersion: z.string().max(50).optional(),
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().max(200).optional(),
  reason: z.string().max(1000).optional(),
})

const JenkinsBundleSchema = z.object({
  kind: z.literal('jenkins'),
  generatedAt: z.string().min(1),
  core: z.object({
    version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
    minimumJava: z.number().int().nullable(),
    javaSource: z.enum(['updates.jenkins.io', 'unavailable']),
    javaCompatible: z.boolean().nullable(),
    warUrl: z.string().url().nullable(),
  }),
  includesTransitive: z.boolean(),
  plugins: z.array(JenkinsPluginSchema).max(500),
  transitivePlugins: z.array(JenkinsPluginSchema).max(1000),
  dependencyTree: z.unknown().optional(),
})

const TransferRequestSchema = z.object({
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
  bundle: z.discriminatedUnion('kind', [GitLabBundleSchema, JenkinsBundleSchema]),
})

type TransferRequest = z.infer<typeof TransferRequestSchema>
type ArchiveEntry = {
  name: string
  url: string
  sizeBytes?: number | null
}

type ArchiveSpec = {
  entries: ArchiveEntry[]
  manifest: unknown
  readme?: string
}

type TransferJobPhase = 'queued' | 'downloading' | 'transferring' | 'completed' | 'failed'

type TransferJob = {
  id: string
  userId: string
  organisationId: string
  phase: TransferJobPhase
  fileName: string
  host: string
  path: string
  filesTotal: number
  filesDone: number
  currentFile: string | null
  currentLoaded: number
  currentTotal: number | null
  error: string | null
  createdAt: number
  updatedAt: number
}

const transferJobs = new Map<string, TransferJob>()

function publishJob(job: TransferJob, patch: Partial<Omit<TransferJob, 'id' | 'userId' | 'organisationId' | 'createdAt'>>) {
  Object.assign(job, patch, { updatedAt: Date.now() })
}

function cleanupOldJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, job] of transferJobs.entries()) {
    if (job.updatedAt < cutoff) transferJobs.delete(id)
  }
}

function gitLabPackageName(edition: z.infer<typeof GitLabEditionSchema>): string {
  return `gitlab-${edition}`
}

function gitLabBasePackageUrl(
  edition: z.infer<typeof GitLabEditionSchema>,
  packageTarget: z.infer<typeof GitLabPackageTargetSchema>,
  arch: string,
): string {
  const target = GitLabTargets[packageTarget]
  const name = gitLabPackageName(edition)
  if (target.kind === 'deb') {
    return `https://packages.gitlab.com/gitlab/${name}/${target.distro}/${target.release}/pool/main/g/${name}/`
  }
  return `https://packages.gitlab.com/gitlab/${name}/${target.distro}/${target.release}/${arch}/Packages/g/`
}

function gitLabPackageFilename(
  edition: z.infer<typeof GitLabEditionSchema>,
  packageTarget: z.infer<typeof GitLabPackageTargetSchema>,
  arch: string,
  version: string,
): string {
  const target = GitLabTargets[packageTarget]
  const name = gitLabPackageName(edition)
  if (target.kind === 'deb') return `${name}_${version}-${edition}.0_${arch}.deb`
  return `${name}-${version}-${edition}.0.${target.distro}${target.release}.${arch}.rpm`
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

function buildGitLabArchive(bundle: z.infer<typeof GitLabBundleSchema>): ArchiveSpec {
  const target = GitLabTargets[bundle.packageTarget.key]
  if (!target.arches.includes(bundle.packageTarget.arch)) {
    throw new Error(`${target.label} does not publish ${bundle.packageTarget.arch} packages`)
  }
  if (bundle.packageTarget.kind !== target.kind || bundle.packageTarget.label !== target.label) {
    throw new Error('GitLab package target metadata does not match the selected target')
  }

  const entries = bundle.steps.map((step) => {
    const filename = gitLabPackageFilename(bundle.edition, bundle.packageTarget.key, bundle.packageTarget.arch, step.version)
    if (step.filename !== filename) {
      throw new Error(`GitLab package metadata mismatch for ${step.version}`)
    }
    return {
      name: `packages/${filename}`,
      url: `${gitLabBasePackageUrl(bundle.edition, bundle.packageTarget.key, bundle.packageTarget.arch)}${filename}`,
      sizeBytes: step.sizeBytes,
    }
  })

  return {
    entries,
    manifest: {
      generatedAt: bundle.generatedAt,
      currentVersion: bundle.currentVersion,
      targetVersion: bundle.targetVersion,
      edition: bundle.edition,
      packageTarget: bundle.packageTarget,
      sources: bundle.sources,
      steps: bundle.steps,
      included: bundle.steps.map((step) => step.id),
    },
    readme: [
      'GitLab air-gap package bundle',
      '',
      `Current version: ${bundle.currentVersion}`,
      `Target version: ${bundle.targetVersion}`,
      `Edition: GitLab ${bundle.edition.toUpperCase()}`,
      `Package target: ${bundle.packageTarget.label} ${bundle.packageTarget.arch}`,
      '',
      'Install each package in ascending version order and allow GitLab background migrations to finish between required stops.',
      'Review GitLab upgrade notes before applying packages.',
    ].join('\n'),
  }
}

async function buildJenkinsArchive(bundle: z.infer<typeof JenkinsBundleSchema>): Promise<ArchiveSpec> {
  const entries: ArchiveEntry[] = []
  if (bundle.core.warUrl) {
    const war = await resolveWarUrl(bundle.core.version)
    if (!war) throw new Error('No Jenkins WAR published for that version')
    entries.push({ name: 'jenkins.war', url: war })
  }

  const seen = new Set<string>()
  const plugins = [...bundle.plugins, ...bundle.transitivePlugins]
    .filter((plugin) => plugin.status === 'compatible' && plugin.version)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  for (const plugin of plugins) {
    const key = plugin.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      name: `plugins/${plugin.name}.hpi`,
      url: `https://updates.jenkins.io/download/plugins/${encodeURIComponent(plugin.name)}/${encodeURIComponent(plugin.version!)}/${encodeURIComponent(plugin.name)}.hpi`,
      sizeBytes: plugin.size ?? null,
    })
  }

  return {
    entries,
    manifest: {
      generatedAt: bundle.generatedAt,
      core: bundle.core,
      includesTransitive: bundle.includesTransitive,
      plugins: bundle.plugins.map((plugin) => ({
        name: plugin.name,
        version: plugin.version ?? null,
        status: plugin.status,
        reason: plugin.reason ?? null,
        requiredCore: plugin.requiredCore ?? null,
        minimumJavaVersion: plugin.minimumJavaVersion ?? null,
        downloaded: plugin.status === 'compatible',
        downloadError: null,
        sha256: plugin.sha256 ?? null,
      })),
      transitivePlugins: bundle.transitivePlugins.map((plugin) => ({
        name: plugin.name,
        version: plugin.version ?? null,
        status: plugin.status,
        reason: plugin.reason ?? null,
        requiredCore: plugin.requiredCore ?? null,
        minimumJavaVersion: plugin.minimumJavaVersion ?? null,
        downloaded: plugin.status === 'compatible',
        downloadError: null,
        sha256: plugin.sha256 ?? null,
      })),
      dependencyTree: bundle.dependencyTree ?? bundle.plugins,
    },
  }
}

type LocalArchiveEntry = ArchiveEntry & {
  localPath: string
}

async function downloadEntryToTemp(entry: ArchiveEntry, localPath: string, job: TransferJob) {
  const upstream = await fetch(entry.url, { cache: 'no-store', redirect: 'follow' })
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Upstream returned ${upstream.status} for ${entry.name}`)
  }
  const contentLength = upstream.headers.get('content-length')
  const total = contentLength ? Number(contentLength) : entry.sizeBytes ?? null
  let loaded = 0
  const source = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>)
  source.on('data', (chunk: Buffer) => {
    loaded += chunk.byteLength
    publishJob(job, {
      currentFile: entry.name,
      currentLoaded: loaded,
      currentTotal: total && Number.isFinite(total) ? total : null,
    })
  })
  await pipeline(source, createWriteStream(localPath))
}

async function streamLocalArchiveToSftp(params: {
  sftp: SFTPWrapper
  remotePath: string
  entries: LocalArchiveEntry[]
  manifest: unknown
  readme?: string
  job: TransferJob
}) {
  await new Promise<void>(async (resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 0 } })
    const out = params.sftp.createWriteStream(params.remotePath)
    let settled = false
    const settle = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve()
    }

    archive.on('warning', (err) => settle(err))
    archive.on('error', (err) => settle(err))
    out.on('error', (err: Error) => settle(err))
    out.on('close', () => settle())

    archive.pipe(out)

    try {
      for (const entry of params.entries) {
        publishJob(params.job, {
          currentFile: entry.name,
          currentLoaded: 0,
          currentTotal: entry.sizeBytes ?? null,
        })
        archive.file(entry.localPath, { name: entry.name })
      }
      archive.append(JSON.stringify(params.manifest, null, 2), { name: 'bundle-manifest.json' })
      if (params.readme) archive.append(params.readme, { name: 'README.txt' })
      await archive.finalize()
    } catch (err) {
      archive.destroy()
      out.destroy()
      settle(err instanceof Error ? err : new Error('Transfer failed'))
    }
  })
}

async function runTransferJob(job: TransferJob, request: TransferRequest) {
  const directory = path.posix.normalize(request.directory)
  const remotePath = path.posix.join(directory, request.fileName)
  let client: Client | null = null
  let tempDir: string | null = null

  try {
    const archive =
      request.bundle.kind === 'gitlab'
        ? buildGitLabArchive(request.bundle)
        : await buildJenkinsArchive(request.bundle)

    publishJob(job, {
      filesTotal: archive.entries.length,
      phase: 'downloading',
      currentFile: null,
      currentLoaded: 0,
      currentTotal: null,
    })

    tempDir = await mkdtemp(path.join(tmpdir(), 'ct-ops-bundle-transfer-'))
    const localEntries: LocalArchiveEntry[] = []

    for (const [index, entry] of archive.entries.entries()) {
      publishJob(job, {
        filesDone: index,
        currentFile: entry.name,
        currentLoaded: 0,
        currentTotal: entry.sizeBytes ?? null,
      })
      const localPath = path.join(tempDir, `${index}-${path.basename(entry.name)}`)
      await downloadEntryToTemp(entry, localPath, job)
      localEntries.push({ ...entry, localPath })
      publishJob(job, {
        filesDone: index + 1,
        currentLoaded: entry.sizeBytes ?? job.currentLoaded,
      })
    }

    publishJob(job, {
      phase: 'transferring',
      currentFile: request.fileName,
      currentLoaded: 0,
      currentTotal: null,
    })

    client = await connectSsh({
      host: job.host,
      username: request.username,
      password: request.password,
    })
    const sftp = await openSftp(client)
    await ensureRemoteDirectory(sftp, directory)
    await streamLocalArchiveToSftp({
      sftp,
      remotePath,
      entries: localEntries,
      manifest: archive.manifest,
      readme: archive.readme,
      job,
    })

    publishJob(job, {
      phase: 'completed',
      filesDone: archive.entries.length,
      currentFile: request.fileName,
      currentLoaded: 0,
      currentTotal: null,
    })
  } catch (err) {
    console.error('Bundle transfer failed:', err)
    publishJob(job, {
      phase: 'failed',
      error: err instanceof Error && err.message ? err.message : 'Transfer failed',
    })
  } finally {
    client?.end()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function getAuthorisedUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  return user?.organisationId ? user : null
}

export async function POST(request: NextRequest) {
  cleanupOldJobs()
  const user = await getAuthorisedUser(request)
  if (!user?.organisationId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = TransferRequestSchema.safeParse(body)
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

  const directory = path.posix.normalize(parsed.data.directory)
  const remotePath = path.posix.join(directory, parsed.data.fileName)
  const job: TransferJob = {
    id: randomUUID(),
    userId: user.id,
    organisationId: user.organisationId,
    phase: 'queued',
    fileName: parsed.data.fileName,
    host: host.hostname,
    path: remotePath,
    filesTotal: 0,
    filesDone: 0,
    currentFile: null,
    currentLoaded: 0,
    currentTotal: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  transferJobs.set(job.id, job)
  void runTransferJob(job, parsed.data)

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    job,
  })
}

export async function GET(request: NextRequest) {
  cleanupOldJobs()
  const user = await getAuthorisedUser(request)
  if (!user?.organisationId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }
  const job = transferJobs.get(jobId)
  if (!job || job.userId !== user.id || job.organisationId !== user.organisationId) {
    return NextResponse.json({ error: 'Transfer job not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, job })
}
