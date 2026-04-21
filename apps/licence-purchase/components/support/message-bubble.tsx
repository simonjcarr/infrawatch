import { cn } from '@/lib/utils'
import { MarkdownRenderer } from './markdown-renderer'
import type { SupportAttachment } from '@/lib/db/schema'

type Author = 'customer' | 'ai' | 'staff'

// Text contrast rule: every combination below has a dark-enough foreground on
// a light-enough background (and vice-versa in dark mode). Staff uses the
// primary colour; AI uses muted; customer uses the card base.
const STYLES: Record<Author, { container: string; label: string }> = {
  customer: {
    container: 'bg-card text-card-foreground ring-1 ring-foreground/10',
    label: 'text-muted-foreground',
  },
  ai: {
    container: 'bg-muted text-foreground ring-1 ring-foreground/10',
    label: 'text-muted-foreground',
  },
  staff: {
    container: 'bg-primary/10 text-foreground ring-1 ring-primary/30',
    label: 'text-primary',
  },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentList({ attachments }: { attachments: SupportAttachment[] }) {
  if (!attachments.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-foreground/10 pt-3">
      {attachments.map((a) => {
        const url = `/api/support/attachments/${a.id}`
        const isImage = a.mimeType.startsWith('image/')
        return (
          <div key={a.id}>
            {isImage ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={a.filename}
                  className="max-h-48 max-w-full rounded border border-foreground/10 object-contain"
                />
                <p className="mt-1 text-xs text-muted-foreground">{a.filename}</p>
              </a>
            ) : (
              <a
                href={url}
                download={a.filename}
                className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="max-w-[180px] truncate">{a.filename}</span>
                <span className="text-muted-foreground">({formatBytes(a.sizeBytes)})</span>
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MessageBubble({
  author,
  authorLabel,
  body,
  createdAt,
  attachments = [],
}: {
  author: Author
  authorLabel: string
  body: string
  createdAt: Date
  attachments?: SupportAttachment[]
}) {
  const styles = STYLES[author]
  return (
    <div className={cn('rounded-lg p-4', styles.container)}>
      <div className="mb-2 flex items-baseline justify-between gap-2 text-xs">
        <span className={cn('font-medium uppercase tracking-wide', styles.label)}>{authorLabel}</span>
        <span className="text-muted-foreground">{new Date(createdAt).toLocaleString()}</span>
      </div>
      {author === 'customer' ? (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</div>
      ) : (
        <MarkdownRenderer>{body}</MarkdownRenderer>
      )}
      <AttachmentList attachments={attachments} />
    </div>
  )
}
