import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'

export interface MarkdownExportOptions {
  headingLevelOffset?: number
}

export interface MarkdownTextRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  href?: string
}

export type MarkdownExportBlock =
  | { type: 'heading'; level: number; children: MarkdownTextRun[] }
  | { type: 'paragraph'; children: MarkdownTextRun[] }
  | { type: 'list'; ordered: boolean; items: MarkdownTextRun[][] }
  | { type: 'blockquote'; children: MarkdownTextRun[] }
  | { type: 'code'; value: string; language?: string }
  | { type: 'table'; rows: MarkdownTextRun[][][] }

type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
  depth?: number
  ordered?: boolean | null
  lang?: string | null
  url?: string
  alt?: string | null
}

interface TextContext {
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  href?: string
}

const parser = unified().use(remarkParse).use(remarkGfm)

function mergeRun(base: TextContext, next: TextContext): TextContext {
  return {
    ...base,
    ...next,
    bold: base.bold || next.bold || undefined,
    italic: base.italic || next.italic || undefined,
    code: base.code || next.code || undefined,
    strike: base.strike || next.strike || undefined,
  }
}

function textRun(text: string, context: TextContext = {}): MarkdownTextRun[] {
  if (!text) return []
  const run: MarkdownTextRun = { text }
  if (context.bold) run.bold = true
  if (context.italic) run.italic = true
  if (context.code) run.code = true
  if (context.strike) run.strike = true
  if (context.href) run.href = context.href
  return [run]
}

function flattenInline(nodes: MdastNode[] = [], context: TextContext = {}): MarkdownTextRun[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case 'text':
        return textRun(node.value ?? '', context)
      case 'strong':
        return flattenInline(node.children, mergeRun(context, { bold: true }))
      case 'emphasis':
        return flattenInline(node.children, mergeRun(context, { italic: true }))
      case 'inlineCode':
        return textRun(node.value ?? '', mergeRun(context, { code: true }))
      case 'delete':
        return flattenInline(node.children, mergeRun(context, { strike: true }))
      case 'link':
        return flattenInline(node.children, mergeRun(context, { href: node.url }))
      case 'break':
        return textRun('\n', context)
      case 'image':
        return textRun(node.alt ? `[Image: ${node.alt}]` : '[Image]', context)
      default:
        return flattenInline(node.children, context)
    }
  })
}

function compactRuns(runs: MarkdownTextRun[]): MarkdownTextRun[] {
  const compacted: MarkdownTextRun[] = []
  for (const run of runs) {
    const previous = compacted[compacted.length - 1]
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.code === run.code &&
      previous.strike === run.strike &&
      previous.href === run.href
    ) {
      previous.text += run.text
    } else if (run.text.length > 0) {
      compacted.push({ ...run })
    }
  }
  return compacted
}

function flattenBlockText(nodes: MdastNode[] = []): MarkdownTextRun[] {
  const runs: MarkdownTextRun[] = []
  for (const child of nodes) {
    if (child.type === 'paragraph' || child.type === 'heading' || child.type === 'tableCell') {
      runs.push(...flattenInline(child.children))
    } else if (child.type === 'code') {
      runs.push(...textRun(child.value ?? '', { code: true }))
    } else {
      runs.push(...flattenBlockText(child.children))
    }
    if (runs.length > 0 && runs[runs.length - 1]?.text !== ' ') {
      runs.push({ text: ' ' })
    }
  }
  if (runs[runs.length - 1]?.text === ' ') runs.pop()
  return compactRuns(runs)
}

function normaliseHeadingLevel(depth: number | undefined, offset: number): number {
  return Math.min(Math.max((depth ?? 1) + offset, 1), 6)
}

function tableRows(node: MdastNode): MarkdownTextRun[][][] {
  return (node.children ?? []).map((row) =>
    (row.children ?? []).map((cell) => compactRuns(flattenInline(cell.children))),
  )
}

export function parseMarkdownForExport(markdown: string, options: MarkdownExportOptions = {}): MarkdownExportBlock[] {
  const tree = parser.parse(markdown) as Root
  const headingLevelOffset = options.headingLevelOffset ?? 0

  return ((tree as MdastNode).children ?? []).flatMap((node): MarkdownExportBlock[] => {
    switch (node.type) {
      case 'heading':
        return [{
          type: 'heading',
          level: normaliseHeadingLevel(node.depth, headingLevelOffset),
          children: compactRuns(flattenInline(node.children)),
        }]
      case 'paragraph': {
        const children = compactRuns(flattenInline(node.children))
        return children.length > 0 ? [{ type: 'paragraph', children }] : []
      }
      case 'list':
        return [{
          type: 'list',
          ordered: Boolean(node.ordered),
          items: (node.children ?? []).map((item) => flattenBlockText(item.children)),
        }]
      case 'blockquote': {
        const children = flattenBlockText(node.children)
        return children.length > 0 ? [{ type: 'blockquote', children }] : []
      }
      case 'code':
        return [{ type: 'code', value: node.value ?? '', language: node.lang ?? undefined }]
      case 'table':
        return [{ type: 'table', rows: tableRows(node) }]
      case 'thematicBreak':
        return [{ type: 'paragraph', children: [{ text: '---' }] }]
      default:
        return []
    }
  })
}
