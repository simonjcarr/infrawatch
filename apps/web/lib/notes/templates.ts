import type { NoteCategory } from '@/lib/db/schema'

// Seed bodies for each category. The editor renders these into the body field
// when an engineer switches category on a new note — giving the "blank page"
// just enough structure to encourage consistent runbooks without locking the
// content shape down. Templates are deliberately plain markdown: no form
// fields, no required headings. Engineers can delete or rearrange freely.
export const NOTE_TEMPLATES: Record<NoteCategory, { title: string; body: string }> = {
  general: {
    title: '',
    body: '',
  },
  runbook: {
    title: '',
    body: [
      '## When to use',
      '',
      '_What situation does this runbook address?_',
      '',
      '## Steps',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Verification',
      '',
      '_How do you confirm the fix worked?_',
      '',
      '## Rollback',
      '',
      '_How to undo if something goes wrong._',
      '',
    ].join('\n'),
  },
  'known-issue': {
    title: '',
    body: [
      '## Symptom',
      '',
      '_What does the issue look like from the outside?_',
      '',
      '## Root cause',
      '',
      '_Why does it happen?_',
      '',
      '## Workaround',
      '',
      '_Short-term mitigation, if any._',
      '',
      '## Permanent fix',
      '',
      '_Tracked in: (ticket / PR link)_',
      '',
    ].join('\n'),
  },
  fix: {
    title: '',
    body: [
      '## Problem',
      '',
      '_What was broken._',
      '',
      '## Fix',
      '',
      '```',
      '# commands / config here',
      '```',
      '',
      '## Why this works',
      '',
      '_Background for the next engineer who hits it._',
      '',
    ].join('\n'),
  },
  contact: {
    title: '',
    body: [
      '## Owner',
      '',
      '- Name: ',
      '- Team: ',
      '- Email: ',
      '- Escalation hours: ',
      '',
      '## Escalation path',
      '',
      '1. ',
      '2. ',
      '',
    ].join('\n'),
  },
  workaround: {
    title: '',
    body: [
      '## Situation',
      '',
      '_When this workaround applies._',
      '',
      '## Workaround',
      '',
      '1. ',
      '2. ',
      '',
      '## Limitations',
      '',
      '_What this does not solve._',
      '',
    ].join('\n'),
  },
}

export function getNoteTemplate(category: NoteCategory): { title: string; body: string } {
  return NOTE_TEMPLATES[category]
}
