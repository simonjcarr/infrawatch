import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import { parseMarkdownForExport } from './markdown-export.ts'
import { renderBuildDocDocx } from './export.ts'

test('markdown export parser preserves document structure and inline formatting', () => {
  const blocks = parseMarkdownForExport(
    [
      '# Header 1',
      '## Header 2',
      '### Header 3',
      '',
      'This is **bold**, *italic*, and `code`.',
      '',
      '- first item',
      '- **second item**',
      '',
      '> Important note',
      '',
      '```bash',
      'dnf update -y',
      '```',
      '',
      '| Step | Result |',
      '| --- | --- |',
      '| Install | Complete |',
    ].join('\n'),
    { headingLevelOffset: 1 },
  )

  assert.deepEqual(blocks.map((block) => block.type), [
    'heading',
    'heading',
    'heading',
    'paragraph',
    'list',
    'blockquote',
    'code',
    'table',
  ])
  assert.deepEqual(blocks.slice(0, 3).map((block) => block.type === 'heading' ? block.level : null), [2, 3, 4])

  const paragraph = blocks[3]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.children, [
    { text: 'This is ' },
    { text: 'bold', bold: true },
    { text: ', ' },
    { text: 'italic', italic: true },
    { text: ', and ' },
    { text: 'code', code: true },
    { text: '.' },
  ])

  const list = blocks[4]
  assert.equal(list.type, 'list')
  assert.equal(list.ordered, false)
  assert.deepEqual(list.items[1], [{ text: 'second item', bold: true }])
})

test('docx export writes markdown as real Word structure instead of flattened plain text', async () => {
  const bytes = await renderBuildDocDocx({
    doc: {
      id: 'doc-1',
      title: 'Alma Linux Test VM',
      status: 'draft',
      fieldValues: {},
      createdAt: new Date('2026-04-01T10:00:00Z'),
      updatedAt: new Date('2026-04-02T10:00:00Z'),
    },
    template: {
      templateId: 'template-1',
      version: 1,
      name: 'Linux VM Build Template',
      layout: {},
      fields: [],
    },
    tableOfContents: [{ id: 'sec-1', number: 1, title: 'Second Section' }],
    sections: [
      {
        id: 'sec-1',
        number: 1,
        title: 'Second Section',
        body: '# Header 1\n## Header 2\n### Header 3\n**bold text**',
        position: 1000,
        fieldValues: {},
        assets: [],
      },
    ],
  })

  const zip = await JSZip.loadAsync(bytes)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert.ok(documentXml)

  assert.match(documentXml, /<w:pStyle w:val="Heading2"\/>/)
  assert.match(documentXml, /<w:pStyle w:val="Heading3"\/>/)
  assert.match(documentXml, /<w:pStyle w:val="Heading4"\/>/)
  assert.match(documentXml, /<w:b\/>/)
  assert.doesNotMatch(documentXml, /Header 1 Header 2 Header 3 bold text/)
})
