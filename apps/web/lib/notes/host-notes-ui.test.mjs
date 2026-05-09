import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL('../../components/notes/notes-tab.tsx', import.meta.url),
  'utf8',
)

test('host notes tab renders notes as a title-only table with row actions', () => {
  assert.match(source, /TableHead>\s*Title\s*<\/TableHead>/)
  assert.match(source, /TableHead>\s*Author\s*<\/TableHead>/)
  assert.match(source, /TableHead>\s*Date\s*<\/TableHead>/)
  assert.match(source, /TableHead[^>]*>\s*<span className="sr-only">Actions<\/span>/)
  assert.match(source, /Pencil className=/)
  assert.match(source, /Trash2 className=/)
  assert.doesNotMatch(source, /<NoteCard\b/)
})

test('host note title opens the full note in a modal', () => {
  assert.match(source, /selectedNote/)
  assert.match(source, /DialogTitle>\{selectedNote\.title\}<\/DialogTitle>/)
  assert.match(source, /<MarkdownRenderer>\{selectedNote\.body\}<\/MarkdownRenderer>/)
})
