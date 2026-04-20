'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

// Keep visual parity with apps/web/components/shared/markdown-renderer.tsx so
// the same AI output looks identical in both products. rehype-sanitize runs
// after the GFM pipeline to strip any embedded HTML — markdown only.
export function MarkdownRenderer({ children }: { children: string }) {
  return (
    <div className="text-sm text-foreground leading-relaxed space-y-3 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-foreground mt-4 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-foreground mt-4 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-foreground mt-3 first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-foreground mt-3 first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="text-sm text-foreground">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground">{children}</ol>
          ),
          li: ({ children }) => <li className="text-sm text-foreground">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return (
                <code className="block bg-muted text-foreground rounded-md px-3 py-2 font-mono text-xs overflow-x-auto">
                  {children}
                </code>
              )
            }
            return (
              <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            )
          },
          pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-semibold bg-muted/50">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 text-foreground">{children}</td>
          ),
          hr: () => <hr className="border-border" />,
          input: ({ checked, disabled }) => (
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              readOnly
              className="mr-1 align-middle"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
