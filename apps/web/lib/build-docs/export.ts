import { createElement, type ReactElement } from 'react'
import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import {
  AlignmentType,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table as DocxTable,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { parseMarkdownForExport, type MarkdownExportBlock, type MarkdownTextRun } from './markdown-export.ts'
import type { BuildDocRenderModel } from './types'

const orderedListReference = 'build-doc-numbered-list'

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#111827' },
  title: { fontSize: 28, marginBottom: 12, fontWeight: 700 },
  meta: { fontSize: 10, color: '#4b5563', marginBottom: 18 },
  h2: { fontSize: 16, marginTop: 16, marginBottom: 8, fontWeight: 700 },
  h3: { fontSize: 14, marginTop: 12, marginBottom: 6, fontWeight: 700 },
  h4: { fontSize: 12, marginTop: 10, marginBottom: 5, fontWeight: 700 },
  body: { lineHeight: 1.45, marginBottom: 6 },
  code: { fontFamily: 'Courier', backgroundColor: '#f3f4f6' },
  codeBlock: { fontFamily: 'Courier', fontSize: 9, backgroundColor: '#f3f4f6', padding: 8, marginBottom: 8 },
  quote: { borderLeftWidth: 3, borderLeftColor: '#9ca3af', paddingLeft: 8, color: '#4b5563', marginBottom: 8 },
  toc: { marginBottom: 20 },
  tocItem: { fontSize: 10, marginBottom: 4 },
  listItem: { lineHeight: 1.45, marginBottom: 3 },
  table: { borderWidth: 1, borderColor: '#d1d5db', marginBottom: 10 },
  tableRow: { flexDirection: 'row' },
  tableCell: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#d1d5db', padding: 4 },
})

function pdfInlineRuns(runs: MarkdownTextRun[], keyPrefix: string): ReactElement[] {
  return runs.map((run, index) => {
    const style = {
      ...(run.bold ? { fontWeight: 700 } : {}),
      ...(run.italic ? { fontStyle: 'italic' as const } : {}),
      ...(run.code ? { fontFamily: 'Courier', backgroundColor: '#f3f4f6' } : {}),
      ...(run.href ? { color: '#2563eb', textDecoration: 'underline' as const } : {}),
    }

    if (run.href) {
      return createElement(Link, { key: `${keyPrefix}-${index}`, src: run.href, style }, run.text)
    }
    return createElement(Text, { key: `${keyPrefix}-${index}`, style }, run.text)
  })
}

function pdfHeadingStyle(level: number) {
  if (level <= 2) return styles.h2
  if (level === 3) return styles.h3
  return styles.h4
}

function pdfBlocks(blocks: MarkdownExportBlock[], keyPrefix: string): ReactElement[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`
    switch (block.type) {
      case 'heading':
        return createElement(Text, { key, style: pdfHeadingStyle(block.level) }, pdfInlineRuns(block.children, key))
      case 'paragraph':
        return createElement(Text, { key, style: styles.body }, pdfInlineRuns(block.children, key))
      case 'blockquote':
        return createElement(View, { key, style: styles.quote },
          createElement(Text, { style: styles.body }, pdfInlineRuns(block.children, key)),
        )
      case 'code':
        return createElement(Text, { key, style: styles.codeBlock }, block.value || ' ')
      case 'list':
        return createElement(View, { key },
          ...block.items.map((item, itemIndex) =>
            createElement(Text, { key: `${key}-item-${itemIndex}`, style: styles.listItem },
              `${block.ordered ? `${itemIndex + 1}.` : '•'} `,
              ...pdfInlineRuns(item, `${key}-item-${itemIndex}`),
            ),
          ),
        )
      case 'table':
        return createElement(View, { key, style: styles.table },
          ...block.rows.map((row, rowIndex) =>
            createElement(View, { key: `${key}-row-${rowIndex}`, style: styles.tableRow },
              ...row.map((cell, cellIndex) =>
                createElement(View, { key: `${key}-cell-${rowIndex}-${cellIndex}`, style: styles.tableCell },
                  createElement(Text, { style: styles.body }, pdfInlineRuns(cell, `${key}-cell-${rowIndex}-${cellIndex}`)),
                ),
              ),
            ),
          ),
        )
      default:
        return createElement(Text, { key, style: styles.body }, '')
    }
  })
}

function PdfDocument({ model }: { model: BuildDocRenderModel }) {
  return createElement(Document, { title: model.doc.title },
    createElement(Page, { size: 'A4', style: styles.page },
      createElement(Text, { style: styles.title }, model.doc.title),
      createElement(Text, { style: styles.meta }, `Template: ${model.template.name} v${model.template.version}`),
      createElement(View, { style: styles.toc },
        createElement(Text, { style: styles.h2 }, 'Index'),
        ...model.tableOfContents.map((item) =>
          createElement(Text, { key: item.id, style: styles.tocItem }, `${item.number}. ${item.title}`),
        ),
      ),
      ...model.sections.map((section) =>
        createElement(View, { key: section.id },
          createElement(Text, { style: styles.h2 }, `${section.number}. ${section.title}`),
          ...(section.body.trim()
            ? pdfBlocks(parseMarkdownForExport(section.body, { headingLevelOffset: 1 }), `section-${section.id}`)
            : [createElement(Text, { key: `${section.id}-empty`, style: styles.body }, 'No section content.')]),
          ...section.assets.map((asset) =>
            createElement(Text, { key: asset.id, style: styles.meta }, `Image: ${asset.filename}`),
          ),
        ),
      ),
    ),
  )
}

export async function renderBuildDocPdf(model: BuildDocRenderModel): Promise<Buffer> {
  return renderToBuffer(PdfDocument({ model }))
}

function docxHeading(level: number) {
  if (level <= 1) return HeadingLevel.HEADING_1
  if (level === 2) return HeadingLevel.HEADING_2
  if (level === 3) return HeadingLevel.HEADING_3
  if (level === 4) return HeadingLevel.HEADING_4
  if (level === 5) return HeadingLevel.HEADING_5
  return HeadingLevel.HEADING_6
}

function textRun(run: MarkdownTextRun): TextRun {
  return new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    strike: run.strike,
    font: run.code ? 'Courier New' : undefined,
    color: run.href ? '2563EB' : undefined,
  })
}

function docxRuns(runs: MarkdownTextRun[]) {
  return runs.map((run) => {
    if (run.href) {
      return new ExternalHyperlink({
        link: run.href,
        children: [textRun(run)],
      })
    }
    return textRun(run)
  })
}

function codeBlockRuns(value: string): TextRun[] {
  const lines = value.split('\n')
  return lines.flatMap((line, index) => [
    new TextRun({
      text: line || ' ',
      font: 'Courier New',
      break: index === 0 ? undefined : 1,
    }),
  ])
}

function docxBlocks(blocks: MarkdownExportBlock[]): Array<Paragraph | DocxTable> {
  return blocks.flatMap((block): Array<Paragraph | DocxTable> => {
    switch (block.type) {
      case 'heading':
        return [new Paragraph({ children: docxRuns(block.children), heading: docxHeading(block.level) })]
      case 'paragraph':
        return [new Paragraph({ children: docxRuns(block.children) })]
      case 'blockquote':
        return [new Paragraph({
          children: docxRuns(block.children),
          border: { left: { color: '9CA3AF', size: 8, style: 'single' } },
        })]
      case 'code':
        return [new Paragraph({
          children: codeBlockRuns(block.value),
          shading: { fill: 'F3F4F6' },
        })]
      case 'list':
        return block.items.map((item) =>
          new Paragraph({
            children: docxRuns(item),
            bullet: block.ordered ? undefined : { level: 0 },
            numbering: block.ordered ? { reference: orderedListReference, level: 0 } : undefined,
          }),
        )
      case 'table':
        return [new DocxTable({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map((row) =>
            new TableRow({
              children: row.map((cell) =>
                new TableCell({
                  children: [new Paragraph({ children: docxRuns(cell) })],
                }),
              ),
            }),
          ),
        })]
      default:
        return []
    }
  })
}

export async function renderBuildDocDocx(model: BuildDocRenderModel): Promise<Buffer> {
  const doc = new DocxDocument({
    numbering: {
      config: [{
        reference: orderedListReference,
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: model.doc.title, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `Template: ${model.template.name} v${model.template.version}` }),
          new Paragraph({ text: 'Index', heading: HeadingLevel.HEADING_1 }),
          new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-4' }),
          ...model.sections.flatMap((section) => [
            new Paragraph({
              text: `${section.number}. ${section.title}`,
              heading: HeadingLevel.HEADING_1,
            }),
            ...(section.body.trim()
              ? docxBlocks(parseMarkdownForExport(section.body, { headingLevelOffset: 1 }))
              : [new Paragraph({ children: [new TextRun('No section content.')] })]),
            ...section.assets.map((asset) => new Paragraph({ text: `Image: ${asset.filename}` })),
          ]),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}
