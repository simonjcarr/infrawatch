/**
 * Storage abstraction for support attachments.
 *
 * Local backend  – files written to SUPPORT_UPLOAD_DIR on the server filesystem.
 *                  storagePath in the DB is an absolute filesystem path.
 *
 * R2 backend     – files written to Cloudflare R2 via the S3-compatible API.
 *                  storagePath in the DB is prefixed with "r2:" followed by
 *                  the S3 object key (e.g. "r2:support-attachments/abc123.png").
 *                  Serving is done via a short-lived presigned URL so the bucket
 *                  itself remains private.
 */

import { mkdir, writeFile, createReadStream as fsCreateReadStream, existsSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { Readable } from 'node:stream'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/lib/env'

const mkdirAsync = promisify(mkdir)

// ── Prefixes ──────────────────────────────────────────────────────────────────

const R2_PREFIX = 'r2:'

export function storagePathToKey(storagePath: string): string {
  return storagePath.slice(R2_PREFIX.length)
}

export function isR2StoragePath(storagePath: string): boolean {
  return storagePath.startsWith(R2_PREFIX)
}

// ── R2 client (lazy singleton) ────────────────────────────────────────────────

let _s3: S3Client | null = null

export function getR2Client(): S3Client {
  if (_s3) return _s3
  if (!env.r2Enabled) throw new Error('R2 is not configured')
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2AccountId!}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId!,
      secretAccessKey: env.r2SecretAccessKey!,
    },
  })
  return _s3
}

// ── Upload ────────────────────────────────────────────────────────────────────

export type UploadResult = {
  storagePath: string
}

export async function uploadAttachment(options: {
  id: string
  ext: string
  buffer: Buffer
  mimeType: string
}): Promise<UploadResult> {
  const { id, ext, buffer, mimeType } = options
  const filename = `${id}${ext}`

  if (env.r2Enabled) {
    const key = `support-attachments/${filename}`
    const s3 = getR2Client()
    await s3.send(
      new PutObjectCommand({
        Bucket: env.r2BucketName!,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // No public access — objects are always served via presigned URLs.
      }),
    )
    return { storagePath: `${R2_PREFIX}${key}` }
  }

  // Local filesystem fallback.
  const uploadDir = path.resolve(env.supportUploadDir)
  await mkdirAsync(uploadDir, { recursive: true })
  const filePath = path.join(uploadDir, filename)
  await promisify(writeFile)(filePath, buffer)
  return { storagePath: filePath }
}

// ── Serve ─────────────────────────────────────────────────────────────────────

export type ServeResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'stream'; stream: ReadableStream; contentLength: number }
  | { kind: 'not_found' }

export async function serveAttachment(options: {
  storagePath: string
  mimeType: string
  sizeBytes: number
  filename: string
}): Promise<ServeResult> {
  const { storagePath, sizeBytes } = options

  if (isR2StoragePath(storagePath)) {
    const key = storagePathToKey(storagePath)
    const s3 = getR2Client()
    const presignedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: env.r2BucketName!,
        Key: key,
        ResponseContentDisposition: options.mimeType.startsWith('image/') || options.mimeType === 'application/pdf'
          ? `inline; filename="${options.filename}"`
          : `attachment; filename="${options.filename}"`,
      }),
      { expiresIn: env.r2PresignedUrlExpirySecs },
    )
    return { kind: 'redirect', url: presignedUrl }
  }

  // Local filesystem.
  if (!existsSync(storagePath)) {
    return { kind: 'not_found' }
  }
  const nodeStream = fsCreateReadStream(storagePath)
  const webStream = Readable.toWeb(nodeStream) as ReadableStream
  return { kind: 'stream', stream: webStream, contentLength: sizeBytes }
}
