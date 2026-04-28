import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'
import type { BuildDocStorageSettingsConfig } from '@/lib/db/schema'
import type { StoredBuildDocAsset } from './types'

export interface BuildDocAssetStorage {
  put(input: {
    organisationId: string
    buildDocId: string
    filename: string
    contentType: string
    bytes: Buffer
  }): Promise<StoredBuildDocAsset>
  get(storageKey: string): Promise<Buffer>
}

function checksum(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function safeExtension(filename: string, contentType: string): string {
  const ext = path.extname(filename).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return ext
  const fallback: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return fallback[contentType] ?? '.img'
}

function createStorageKey(input: { organisationId: string; buildDocId: string; filename: string; contentType: string }): string {
  const id = crypto.randomUUID()
  return `${input.organisationId}/${input.buildDocId}/${id}${safeExtension(input.filename, input.contentType)}`
}

export class FilesystemBuildDocAssetStorage implements BuildDocAssetStorage {
  constructor(private readonly rootPath = process.env['BUILD_DOC_ASSET_ROOT'] ?? path.join(process.cwd(), '.build-doc-assets')) {}

  async put(input: {
    organisationId: string
    buildDocId: string
    filename: string
    contentType: string
    bytes: Buffer
  }): Promise<StoredBuildDocAsset> {
    const storageKey = createStorageKey(input)
    const absolute = path.resolve(this.rootPath, storageKey)
    const root = path.resolve(this.rootPath)
    if (!absolute.startsWith(root + path.sep)) {
      throw new Error('Invalid asset path')
    }
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, input.bytes, { flag: 'wx' })
    return {
      provider: 'filesystem',
      storageKey,
      checksumSha256: checksum(input.bytes),
      sizeBytes: input.bytes.length,
    }
  }

  async get(storageKey: string): Promise<Buffer> {
    const absolute = path.resolve(this.rootPath, storageKey)
    const root = path.resolve(this.rootPath)
    if (!absolute.startsWith(root + path.sep)) {
      throw new Error('Invalid asset path')
    }
    return readFile(absolute)
  }
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export class S3BuildDocAssetStorage implements BuildDocAssetStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: NonNullable<BuildDocStorageSettingsConfig['s3']>) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    })
  }

  async put(input: {
    organisationId: string
    buildDocId: string
    filename: string
    contentType: string
    bytes: Buffer
  }): Promise<StoredBuildDocAsset> {
    const storageKey = createStorageKey(input)
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: input.bytes,
      ContentType: input.contentType,
      Metadata: {
        organisationId: input.organisationId,
        buildDocId: input.buildDocId,
        checksumSha256: checksum(input.bytes),
      },
    }))
    return {
      provider: 's3',
      storageKey,
      checksumSha256: checksum(input.bytes),
      sizeBytes: input.bytes.length,
    }
  }

  async get(storageKey: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }))
    if (!result.Body) throw new Error('Asset not found')
    return streamToBuffer(result.Body)
  }
}

export function createBuildDocAssetStorage(config?: BuildDocStorageSettingsConfig | null): BuildDocAssetStorage {
  if (config?.provider === 's3' && config.s3) {
    return new S3BuildDocAssetStorage(config.s3)
  }
  return new FilesystemBuildDocAssetStorage(config?.filesystem?.rootPath)
}
