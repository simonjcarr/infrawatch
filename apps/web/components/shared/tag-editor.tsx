'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { searchTags } from '@/lib/actions/tags'

export interface EditorTag {
  // id is only present for persisted assignments (when mode === 'persisted');
  // locally-added tags have no id yet.
  id?: string
  key: string
  value: string
}

export interface TagEditorProps {
  orgId: string
  value: EditorTag[]
  onChange: (next: EditorTag[]) => void
  disabled?: boolean
  className?: string
}

function useDebounced<T>(value: T, ms = 150): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

// Normalises a pair for dedupe comparison — keys collapse case-insensitively
// so "Env" and "env" are treated as the same key.
function normKey(k: string): string {
  return k.trim().toLowerCase()
}

export function TagEditor({
  orgId,
  value,
  onChange,
  disabled,
  className,
}: TagEditorProps) {
  const [keyInput, setKeyInput] = React.useState('')
  const [valueInput, setValueInput] = React.useState('')
  const [keyOpen, setKeyOpen] = React.useState(false)
  const [valueOpen, setValueOpen] = React.useState(false)
  const keyRef = React.useRef<HTMLInputElement>(null)
  const valueRef = React.useRef<HTMLInputElement>(null)

  const debKey = useDebounced(keyInput)
  const debValue = useDebounced(valueInput)

  // Key suggestions: prefix match on any key in this org's tag catalogue.
  // Distinct keys (via de-dupe on the client) so typing "env" doesn't fan out
  // into one entry per value.
  const keyQuery = useQuery({
    queryKey: ['tag-search-keys', orgId, debKey],
    queryFn: async () => {
      const rows = await searchTags(orgId, debKey, { limit: 25 })
      const seen = new Set<string>()
      const uniqueKeys: Array<{ key: string; count: number }> = []
      for (const r of rows) {
        const k = r.key
        if (!seen.has(k.toLowerCase())) {
          seen.add(k.toLowerCase())
          uniqueKeys.push({ key: k, count: r.usageCount })
        }
      }
      return uniqueKeys.slice(0, 8)
    },
    enabled: keyOpen,
    staleTime: 5_000,
  })

  // Value suggestions scoped to the currently-typed key. This is the core
  // dedupe UX — once a user commits "env", only pre-existing values under
  // "env" are suggested.
  const valueQuery = useQuery({
    queryKey: ['tag-search-values', orgId, keyInput, debValue],
    queryFn: () => searchTags(orgId, debValue, { key: keyInput.trim(), limit: 10 }),
    enabled: valueOpen && keyInput.trim().length > 0,
    staleTime: 5_000,
  })

  const addTag = React.useCallback(
    (k: string, v: string) => {
      const key = k.trim()
      const val = v.trim()
      if (!key || !val) return
      const filtered = value.filter((t) => normKey(t.key) !== normKey(key))
      onChange([...filtered, { key, value: val }])
      setKeyInput('')
      setValueInput('')
      setKeyOpen(false)
      setValueOpen(false)
      keyRef.current?.focus()
    },
    [value, onChange],
  )

  const removeTag = React.useCallback(
    (idx: number) => {
      const next = [...value]
      next.splice(idx, 1)
      onChange(next)
    },
    [value, onChange],
  )

  const commitFromInputs = () => addTag(keyInput, valueInput)

  const onKeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (keyInput.trim()) valueRef.current?.focus()
    }
  }
  const onValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitFromInputs()
    }
  }

  return (
    <div className={className}>
      {value.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {value.map((t, i) => (
            <Badge
              key={`${t.key}:${t.value}:${i}`}
              variant="secondary"
              className="gap-1 pr-1 font-mono text-xs"
            >
              <span>
                {t.key}
                <span className="opacity-60">:</span>
                {t.value}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeTag(i)}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-background/60"
                  aria-label={`Remove tag ${t.key}:${t.value}`}
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="tag-editor-key" className="text-xs mb-1 block">
              Key
            </Label>
            <Popover open={keyOpen && (keyQuery.data?.length ?? 0) > 0} onOpenChange={setKeyOpen}>
              <PopoverAnchor asChild>
                <Input
                  id="tag-editor-key"
                  ref={keyRef}
                  data-testid="tag-editor-key"
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value)
                    setKeyOpen(true)
                  }}
                  onFocus={() => setKeyOpen(true)}
                  onKeyDown={onKeyKeyDown}
                  placeholder="env"
                  autoComplete="off"
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                sideOffset={4}
                className="w-[var(--radix-popover-trigger-width)] p-1"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <div className="flex flex-col">
                  {(keyQuery.data ?? []).map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setKeyInput(k.key)
                        setKeyOpen(false)
                        valueRef.current?.focus()
                      }}
                    >
                      <span className="font-mono">{k.key}</span>
                      <span className="text-xs text-muted-foreground">{k.count}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="tag-editor-value" className="text-xs mb-1 block">
              Value
            </Label>
            <Popover open={valueOpen && (valueQuery.data?.length ?? 0) > 0} onOpenChange={setValueOpen}>
              <PopoverAnchor asChild>
                <Input
                  id="tag-editor-value"
                  ref={valueRef}
                  data-testid="tag-editor-value"
                  value={valueInput}
                  onChange={(e) => {
                    setValueInput(e.target.value)
                    setValueOpen(true)
                  }}
                  onFocus={() => setValueOpen(true)}
                  onKeyDown={onValueKeyDown}
                  placeholder="prod"
                  autoComplete="off"
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                sideOffset={4}
                className="w-[var(--radix-popover-trigger-width)] p-1"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <div className="flex flex-col">
                  {(valueQuery.data ?? []).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        addTag(keyInput, t.value)
                      }}
                    >
                      <span className="font-mono">{t.value}</span>
                      <span className="text-xs text-muted-foreground">{t.usageCount}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={commitFromInputs}
            disabled={!keyInput.trim() || !valueInput.trim()}
            data-testid="tag-editor-add"
          >
            Add
          </Button>
        </div>
      )}
    </div>
  )
}
