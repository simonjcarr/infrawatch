import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { compareVersions } from '@/lib/version-compare'

export const runtime = 'nodejs'

const UPGRADE_PATH_SOURCE =
  'https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/update/upgrade_paths.md'

const PackageTargetSchema = z.enum([
  'ubuntu-noble',
  'ubuntu-jammy',
  'ubuntu-focal',
  'debian-bookworm',
  'debian-bullseye',
  'el-9',
  'el-8',
])

const EditionSchema = z.enum(['ee', 'ce'])
const VersionSchema = z.string().regex(/^\d+\.\d+(\.\d+)?$/, 'Expected version like 17.11.7')

const ResolveSchema = z.object({
  action: z.literal('resolve'),
  currentVersion: VersionSchema,
  targetVersion: VersionSchema,
  edition: EditionSchema,
  packageTarget: PackageTargetSchema,
  arch: z.enum(['amd64', 'arm64', 'x86_64', 'aarch64']),
})

const LatestSchema = z.object({
  action: z.literal('latest'),
  edition: EditionSchema,
  packageTarget: PackageTargetSchema,
  arch: z.enum(['amd64', 'arm64', 'x86_64', 'aarch64']),
})

const BodySchema = z.discriminatedUnion('action', [ResolveSchema, LatestSchema])

const QuerySchema = z.object({
  edition: EditionSchema,
  packageTarget: PackageTargetSchema,
  arch: z.enum(['amd64', 'arm64', 'x86_64', 'aarch64']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
})

type PackageTarget = z.infer<typeof PackageTargetSchema>
type Edition = z.infer<typeof EditionSchema>

type PackageRepoTarget = {
  kind: 'deb' | 'rpm'
  distro: string
  release: string
  label: string
  arches: readonly string[]
}

const PACKAGE_TARGETS: Record<PackageTarget, PackageRepoTarget> = {
  'ubuntu-noble': {
    kind: 'deb',
    distro: 'ubuntu',
    release: 'noble',
    label: 'Ubuntu 24.04 Noble',
    arches: ['amd64', 'arm64'],
  },
  'ubuntu-jammy': {
    kind: 'deb',
    distro: 'ubuntu',
    release: 'jammy',
    label: 'Ubuntu 22.04 Jammy',
    arches: ['amd64', 'arm64'],
  },
  'ubuntu-focal': {
    kind: 'deb',
    distro: 'ubuntu',
    release: 'focal',
    label: 'Ubuntu 20.04 Focal',
    arches: ['amd64', 'arm64'],
  },
  'debian-bookworm': {
    kind: 'deb',
    distro: 'debian',
    release: 'bookworm',
    label: 'Debian 12 Bookworm',
    arches: ['amd64', 'arm64'],
  },
  'debian-bullseye': {
    kind: 'deb',
    distro: 'debian',
    release: 'bullseye',
    label: 'Debian 11 Bullseye',
    arches: ['amd64', 'arm64'],
  },
  'el-9': {
    kind: 'rpm',
    distro: 'el',
    release: '9',
    label: 'RHEL/Rocky/Alma 9',
    arches: ['x86_64', 'aarch64'],
  },
  'el-8': {
    kind: 'rpm',
    distro: 'el',
    release: '8',
    label: 'RHEL/Rocky/Alma 8',
    arches: ['x86_64', 'aarch64'],
  },
}

export type GitLabBundleStep = {
  id: string
  role: 'required-stop' | 'target'
  version: string
  majorMinor: string
  sourceVersion: string
  conditional: boolean
  note: string | null
  packageName: string
  filename: string | null
  url: string | null
  sizeBytes: number | null
  sizeLabel: string | null
  status: 'available' | 'not-found'
  reason?: string
}

export type GitLabBundlerResponse =
  | {
      ok: true
      currentVersion: string
      targetVersion: string
      edition: Edition
      packageTarget: {
        key: PackageTarget
        label: string
        arch: string
        kind: 'deb' | 'rpm'
      }
      generatedAt: string
      sources: {
        upgradePath: string
        packages: string
      }
      steps: GitLabBundleStep[]
    }
  | { ok: false; error: string }

export type GitLabLatestVersionResponse =
  | {
      ok: true
      version: string
      edition: Edition
      packageTarget: {
        key: PackageTarget
        label: string
        arch: string
        kind: 'deb' | 'rpm'
      }
      sources: {
        packages: string
      }
    }
  | { ok: false; error: string }

type RequiredStop = {
  version: string
  note: string | null
  conditional: boolean
}

type PackageCandidate = {
  version: string
  filename: string
  url: string
  sizeBytes: number | null
  sizeLabel: string | null
}

function packageNameFor(edition: Edition): string {
  return `gitlab-${edition}`
}

function majorMinor(version: string): string {
  const [major, minor] = version.split('.')
  return `${major}.${minor}`
}

function fullVersion(version: string): string {
  const parts = version.split('.')
  return parts.length === 2 ? `${version}.0` : version
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseRequiredStops(markdown: string, currentVersion: string, targetVersion: string): RequiredStop[] {
  const stops = new Map<string, RequiredStop>()

  for (const section of markdown.split(/^### /m)) {
    const heading = section.match(/^Required GitLab (\d+) upgrade stops/)
    if (!heading) continue
    const major = Number(heading[1])

    const minorLine = section.split('\n').find((line) => line.includes('occur at versions'))
    if (minorLine) {
      for (const match of minorLine.matchAll(/`(\d+\.\d+)`/g)) {
        const version = `${match[1]}.0`
        stops.set(version, {
          version,
          note: `Required GitLab ${match[1]} upgrade stop. Use the latest available patch release for this minor version.`,
          conditional: false,
        })
      }
    }

    for (const line of section.split('\n')) {
      const row = line.match(/^\|\s*(\d+\.\d+\.\d+)\s*\|\s*(.*?)\s*\|$/)
      if (!row) continue
      const note = stripMarkdown(row[2] ?? '')
      stops.set(row[1]!, {
        version: row[1]!,
        note: note || null,
        conditional: /required only/i.test(note),
      })
    }

    // GitLab documents the x.2/x.5/x.8/x.11 cadence for 17.5 and later. Use
    // that rule for newer major versions even before a per-version section is
    // added to the docs page.
    if (major >= 18) {
      for (const minor of [2, 5, 8, 11]) {
        const version = `${major}.${minor}.0`
        if (!stops.has(version)) {
          stops.set(version, {
            version,
            note: `Required GitLab ${major}.${minor} upgrade stop from GitLab's x.2/x.5/x.8/x.11 cadence. Use the latest available patch release for this minor version.`,
            conditional: false,
          })
        }
      }
    }
  }

  const current = fullVersion(currentVersion)
  const target = fullVersion(targetVersion)
  const targetMajor = Number(target.split('.')[0])
  const maxMajor = Number.isFinite(targetMajor) ? targetMajor : 18

  for (let major = 19; major <= maxMajor; major++) {
    for (const minor of [2, 5, 8, 11]) {
      const version = `${major}.${minor}.0`
      if (!stops.has(version)) {
        stops.set(version, {
          version,
          note: `Required GitLab ${major}.${minor} upgrade stop from GitLab's x.2/x.5/x.8/x.11 cadence. Use the latest available patch release for this minor version.`,
          conditional: false,
        })
      }
    }
  }

  const targetMm = majorMinor(target)
  return Array.from(stops.values())
    .filter((stop) => {
      if (majorMinor(stop.version) === targetMm) return false
      return compareVersions(stop.version, current) > 0 && compareVersions(stop.version, target) < 0
    })
    .sort((a, b) => compareVersions(a.version, b.version))
}

function basePackageUrl(edition: Edition, target: PackageRepoTarget, arch: string): string {
  const name = packageNameFor(edition)
  if (target.kind === 'deb') {
    return `https://packages.gitlab.com/gitlab/${name}/${target.distro}/${target.release}/pool/main/g/${name}/`
  }
  return `https://packages.gitlab.com/gitlab/${name}/${target.distro}/${target.release}/${arch}/Packages/g/`
}

function packageFilename(edition: Edition, target: PackageRepoTarget, arch: string, version: string): string {
  const name = packageNameFor(edition)
  if (target.kind === 'deb') return `${name}_${version}-${edition}.0_${arch}.deb`
  return `${name}-${version}-${edition}.0.${target.distro}${target.release}.${arch}.rpm`
}

function parseSizeLabel(label: string): number | null {
  const match = label.trim().match(/^([\d.]+)\s*([KMGT]?B)$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2]!.toUpperCase()
  const multiplier =
    unit === 'TB' ? 1024 ** 4 :
    unit === 'GB' ? 1024 ** 3 :
    unit === 'MB' ? 1024 ** 2 :
    unit === 'KB' ? 1024 :
    1
  return Math.round(value * multiplier)
}

async function fetchPackageCandidates(
  edition: Edition,
  packageTarget: PackageTarget,
  arch: string,
): Promise<{ candidates: PackageCandidate[]; repoUrl: string }> {
  const target = PACKAGE_TARGETS[packageTarget]
  if (!target.arches.includes(arch)) {
    throw new Error(`${target.label} does not publish ${arch} packages`)
  }

  const repoUrl = basePackageUrl(edition, target, arch)
  const res = await fetch(repoUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Unable to fetch GitLab package index (${res.status})`)
  const html = await res.text()
  const name = packageNameFor(edition)
  const candidates: PackageCandidate[] = []

  for (const line of html.split('\n')) {
    const filePattern =
      target.kind === 'deb'
        ? new RegExp(`href="(${name}_(\\d+\\.\\d+\\.\\d+)-${edition}\\.0_${arch}\\.deb)"`)
        : new RegExp(`href="(${name}-(\\d+\\.\\d+\\.\\d+)-${edition}\\.0\\.${target.distro}${target.release}\\.${arch}\\.rpm)"`)
    const match = line.match(filePattern)
    if (!match) continue
    const sizeMatch = line.match(/>\s*(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})\s+([\d.]+\s*[KMGT]?B)\s*$/)
    const sizeLabel = sizeMatch?.[2]?.trim() ?? null
    candidates.push({
      filename: match[1]!,
      version: match[2]!,
      url: `${repoUrl}${match[1]!}`,
      sizeBytes: sizeLabel ? parseSizeLabel(sizeLabel) : null,
      sizeLabel,
    })
  }

  return { candidates, repoUrl }
}

function findPackage(candidates: PackageCandidate[], version: string, allowLatestPatch: boolean): PackageCandidate | null {
  const normalized = fullVersion(version)
  if (!allowLatestPatch) {
    return candidates.find((candidate) => candidate.version === normalized) ?? null
  }
  const mm = majorMinor(normalized)
  const matching = candidates
    .filter((candidate) => majorMinor(candidate.version) === mm)
    .sort((a, b) => compareVersions(a.version, b.version))
  return matching.at(-1) ?? null
}

function createStep(
  params: {
    role: 'required-stop' | 'target'
    sourceVersion: string
    note: string | null
    conditional: boolean
    packageName: string
    candidate: PackageCandidate | null
  },
): GitLabBundleStep {
  const version = params.candidate?.version ?? fullVersion(params.sourceVersion)
  return {
    id: `${params.role}-${version}`,
    role: params.role,
    version,
    majorMinor: majorMinor(version),
    sourceVersion: params.sourceVersion,
    conditional: params.conditional,
    note: params.note,
    packageName: params.packageName,
    filename: params.candidate?.filename ?? null,
    url: params.candidate?.url ?? null,
    sizeBytes: params.candidate?.sizeBytes ?? null,
    sizeLabel: params.candidate?.sizeLabel ?? null,
    status: params.candidate ? 'available' : 'not-found',
    reason: params.candidate
      ? undefined
      : `No ${params.packageName} package found for ${params.sourceVersion}`,
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<GitLabBundlerResponse | GitLabLatestVersionResponse>> {
  try {
    const raw = await req.json()
    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }

    const body = parsed.data

    if (body.action === 'latest') {
      const targetDef = PACKAGE_TARGETS[body.packageTarget]
      if (!targetDef.arches.includes(body.arch)) {
        return NextResponse.json(
          { ok: false, error: `${targetDef.label} does not publish ${body.arch} packages` },
          { status: 400 },
        )
      }

      const packageData = await fetchPackageCandidates(body.edition, body.packageTarget, body.arch)
      const latest = packageData.candidates.sort((a, b) => compareVersions(a.version, b.version)).at(-1)
      if (!latest) {
        return NextResponse.json({ ok: false, error: 'No GitLab packages found for the selected target' }, { status: 404 })
      }

      return NextResponse.json({
        ok: true,
        version: latest.version,
        edition: body.edition,
        packageTarget: {
          key: body.packageTarget,
          label: targetDef.label,
          arch: body.arch,
          kind: targetDef.kind,
        },
        sources: {
          packages: packageData.repoUrl,
        },
      })
    }

    const current = fullVersion(body.currentVersion)
    const target = fullVersion(body.targetVersion)
    if (compareVersions(current, target) >= 0) {
      return NextResponse.json({ ok: false, error: 'Target version must be newer than the current version' }, { status: 400 })
    }

    const targetDef = PACKAGE_TARGETS[body.packageTarget]
    if (!targetDef.arches.includes(body.arch)) {
      return NextResponse.json(
        { ok: false, error: `${targetDef.label} does not publish ${body.arch} packages` },
        { status: 400 },
      )
    }

    const [upgradePathRes, packageData] = await Promise.all([
      fetch(UPGRADE_PATH_SOURCE, { cache: 'no-store' }),
      fetchPackageCandidates(body.edition, body.packageTarget, body.arch),
    ])
    if (!upgradePathRes.ok) {
      return NextResponse.json({ ok: false, error: `Unable to fetch GitLab upgrade path docs (${upgradePathRes.status})` }, { status: 502 })
    }
    const markdown = await upgradePathRes.text()
    const stops = parseRequiredStops(markdown, current, target)
    const packageName = packageNameFor(body.edition)

    const steps = stops.map((stop) =>
      createStep({
        role: 'required-stop',
        sourceVersion: stop.version,
        note: stop.note,
        conditional: stop.conditional,
        packageName,
        candidate: findPackage(packageData.candidates, stop.version, true),
      }),
    )

    const targetCandidate = findPackage(
      packageData.candidates,
      target,
      body.targetVersion.split('.').length === 2,
    )
    steps.push(
      createStep({
        role: 'target',
        sourceVersion: target,
        note: majorMinor(target) === majorMinor(targetCandidate?.version ?? target)
          ? 'Target version selected by the user.'
          : null,
        conditional: false,
        packageName,
        candidate: targetCandidate,
      }),
    )

    const deduped = Array.from(
      steps.reduce((acc, step) => acc.set(step.majorMinor, step), new Map<string, GitLabBundleStep>()).values(),
    ).sort((a, b) => compareVersions(a.version, b.version))

    return NextResponse.json({
      ok: true,
      currentVersion: current,
      targetVersion: targetCandidate?.version ?? target,
      edition: body.edition,
      packageTarget: {
        key: body.packageTarget,
        label: targetDef.label,
        arch: body.arch,
        kind: targetDef.kind,
      },
      generatedAt: new Date().toISOString(),
      sources: {
        upgradePath: UPGRADE_PATH_SOURCE,
        packages: packageData.repoUrl,
      },
      steps: deduped,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve GitLab packages'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries())
  const parsed = QuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid or missing parameters' }, { status: 400 })
  }

  const target = PACKAGE_TARGETS[parsed.data.packageTarget]
  if (!target.arches.includes(parsed.data.arch)) {
    return NextResponse.json({ ok: false, error: 'Unsupported architecture for package target' }, { status: 400 })
  }

  const filename = packageFilename(parsed.data.edition, target, parsed.data.arch, parsed.data.version)
  const url = `${basePackageUrl(parsed.data.edition, target, parsed.data.arch)}${filename}`
  const upstream = await fetch(url, { cache: 'no-store', redirect: 'follow' })
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ ok: false, error: `Upstream returned ${upstream.status}` }, { status: 502 })
  }

  const headers = new Headers()
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream')
  headers.set('content-disposition', `attachment; filename="${filename}"`)
  headers.set('cache-control', 'no-store')
  const cl = upstream.headers.get('content-length') ?? upstream.headers.get('x-pulp-artifact-size')
  if (cl) headers.set('content-length', cl)

  return new Response(upstream.body, { status: 200, headers })
}
