import { cn } from '@/lib/utils'
import { MarkdownRenderer } from './markdown-renderer'

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

export function MessageBubble({
  author,
  authorLabel,
  body,
  createdAt,
}: {
  author: Author
  authorLabel: string
  body: string
  createdAt: Date
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
    </div>
  )
}
