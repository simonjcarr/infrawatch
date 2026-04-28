import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSnippetSnapshot,
  normaliseSectionOrder,
  validateAssetUpload,
  validateTemplateFieldValues,
} from './validation.ts'

const templateFields = [
  { id: 'customer', label: 'Customer', type: 'text', required: true },
  { id: 'changeRef', label: 'Change reference', type: 'text', required: false },
  { id: 'production', label: 'Production VM', type: 'boolean', required: true },
]

test('required template fields block incomplete build documents', () => {
  const result = validateTemplateFieldValues(templateFields, { customer: 'Acme' })

  assert.equal(result.success, false)
  assert.match(result.error, /Production VM/)
})

test('optional template fields can be omitted', () => {
  const result = validateTemplateFieldValues(templateFields, {
    customer: 'Acme',
    production: true,
  })

  assert.deepEqual(result, {
    success: true,
    values: {
      customer: 'Acme',
      production: true,
    },
  })
})

test('section reorder updates positions deterministically', () => {
  assert.deepEqual(normaliseSectionOrder(['sec-c', 'sec-a', 'sec-b']), [
    { id: 'sec-c', position: 1000 },
    { id: 'sec-a', position: 2000 },
    { id: 'sec-b', position: 3000 },
  ])
})

test('snippet insertion snapshots content and provenance', () => {
  const snapshot = createSnippetSnapshot({
    id: 'snippet-1',
    version: 4,
    title: 'Install nginx',
    body: 'apt install nginx',
  })

  assert.deepEqual(snapshot, {
    sourceSnippetId: 'snippet-1',
    sourceSnippetVersion: 4,
    title: 'Install nginx',
    body: 'apt install nginx',
  })
})

test('asset validation rejects non-images and oversize uploads', () => {
  assert.equal(validateAssetUpload({ contentType: 'image/png', size: 1024 }).success, true)
  assert.match(
    validateAssetUpload({ contentType: 'text/html', size: 1024 }).error,
    /Unsupported image type/,
  )
  assert.match(
    validateAssetUpload({ contentType: 'image/png', size: 12 * 1024 * 1024 }).error,
    /too large/,
  )
})
