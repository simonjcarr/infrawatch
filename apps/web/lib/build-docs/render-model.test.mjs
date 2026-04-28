import test from 'node:test'
import assert from 'node:assert/strict'

import { buildRenderModel } from './render-model.ts'

test('render model sorts sections and derives table of contents', () => {
  const model = buildRenderModel({
    doc: {
      id: 'doc-1',
      title: 'VM build',
      status: 'draft',
      fieldValues: { customer: 'Acme' },
      createdAt: new Date('2026-04-01T10:00:00Z'),
      updatedAt: new Date('2026-04-02T10:00:00Z'),
    },
    templateVersion: {
      templateId: 'template-1',
      version: 2,
      name: 'Standard VM',
      layout: { accentColor: '#2563eb' },
      fields: [{ id: 'customer', label: 'Customer', type: 'text', required: true }],
    },
    sections: [
      { id: 'sec-2', title: 'Install packages', body: 'Install nginx.', position: 2000, fieldValues: {} },
      { id: 'sec-1', title: 'Provision VM', body: 'Create the VM.', position: 1000, fieldValues: {} },
    ],
    assets: [],
  })

  assert.deepEqual(model.tableOfContents, [
    { id: 'sec-1', number: 1, title: 'Provision VM' },
    { id: 'sec-2', number: 2, title: 'Install packages' },
  ])
  assert.deepEqual(model.sections.map((section) => section.number), [1, 2])
})

test('render model attaches images to their owning section only', () => {
  const model = buildRenderModel({
    doc: {
      id: 'doc-1',
      title: 'VM build',
      status: 'draft',
      fieldValues: {},
      createdAt: new Date('2026-04-01T10:00:00Z'),
      updatedAt: new Date('2026-04-02T10:00:00Z'),
    },
    templateVersion: {
      templateId: 'template-1',
      version: 1,
      name: 'Standard VM',
      layout: {},
      fields: [],
    },
    sections: [
      { id: 'sec-1', title: 'Provision VM', body: 'Create the VM.', position: 1000, fieldValues: {} },
      { id: 'sec-2', title: 'Install packages', body: 'Install nginx.', position: 2000, fieldValues: {} },
    ],
    assets: [
      {
        id: 'asset-1',
        sectionId: 'sec-2',
        filename: 'nginx.png',
        contentType: 'image/png',
        url: '/api/build-docs/assets/asset-1',
      },
    ],
  })

  assert.equal(model.sections[0].assets.length, 0)
  assert.deepEqual(model.sections[1].assets.map((asset) => asset.filename), ['nginx.png'])
})
