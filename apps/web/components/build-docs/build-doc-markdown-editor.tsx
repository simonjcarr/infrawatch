'use client'

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import { cn } from '@/lib/utils'

interface BuildDocMarkdownEditorProps {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  fullscreen?: boolean
  placeholder?: string
  testId?: string
}

function subscribeToClientSnapshot() {
  return () => {}
}

export function BuildDocMarkdownEditor({
  id,
  name,
  value,
  onChange,
  readOnly = false,
  fullscreen = false,
  placeholder = 'Write build notes, commands, checks, and handover detail.',
  testId = 'build-doc-markdown-editor',
}: BuildDocMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const latestValue = useRef(value)
  const mounted = useRef(false)
  const isClient = useSyncExternalStore(subscribeToClientSnapshot, () => true, () => false)

  const plugins = useMemo(() => {
    const basePlugins = [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: 'bash' }),
      diffSourcePlugin({ viewMode: 'rich-text' }),
      markdownShortcutPlugin(),
    ]

    if (readOnly) return basePlugins

    return [...basePlugins, toolbarPlugin({
      toolbarClassName: 'build-doc-markdown-editor__toolbar',
      toolbarContents: () => (
        <DiffSourceToggleWrapper options={['rich-text', 'source']}>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <Separator />
          <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
          <CodeToggle />
          <Separator />
          <ListsToggle options={['bullet', 'number', 'check']} />
          <Separator />
          <CreateLink />
          <InsertCodeBlock />
          <InsertTable />
          <InsertThematicBreak />
        </DiffSourceToggleWrapper>
      ),
    })]
  }, [readOnly])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (value === latestValue.current) return
    latestValue.current = value
    editorRef.current?.setMarkdown(value)
  }, [value])

  function handleChange(next: string, initialMarkdownNormalize: boolean) {
    if (!mounted.current) return
    if (initialMarkdownNormalize && next === latestValue.current) return
    latestValue.current = next
    onChange(next)
  }

  return (
    <div
      id={id}
      data-testid={testId}
      className={cn(
        'build-doc-markdown-editor rounded-md border border-input bg-background text-foreground shadow-sm',
        fullscreen ? 'build-doc-markdown-editor--fullscreen min-h-[calc(100vh-13rem)]' : 'min-h-[360px]',
        readOnly && 'opacity-90',
      )}
    >
      {name && <textarea name={name} value={value} readOnly hidden />}
      {isClient ? (
        <MDXEditor
          ref={editorRef}
          markdown={value}
          onChange={handleChange}
          readOnly={readOnly}
          placeholder={placeholder}
          suppressHtmlProcessing
          trim={false}
          plugins={plugins}
          className="build-doc-markdown-editor__root"
          contentEditableClassName={cn(
            'build-doc-markdown-editor__content',
            fullscreen ? 'min-h-[calc(100vh-17rem)]' : 'min-h-[300px]',
          )}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            'build-doc-markdown-editor__content',
            fullscreen ? 'min-h-[calc(100vh-17rem)]' : 'min-h-[300px]',
          )}
        />
      )}
    </div>
  )
}
