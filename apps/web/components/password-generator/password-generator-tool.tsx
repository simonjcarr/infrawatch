'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Dices, KeyRound, RefreshCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  estimatePasswordStrength,
  generatePassword,
  normalisePasswordGeneratorOptions,
  type PasswordGeneratorMode,
  type PasswordGeneratorOptions,
} from '@/lib/password-generator'
import { cn } from '@/lib/utils'

type PasswordGeneratorToolProps = {
  className?: string
  onUsePassword?: (password: string) => void
  showHeading?: boolean
}

const PRESETS: Array<{
  id: string
  label: string
  options: Partial<PasswordGeneratorOptions>
}> = [
  {
    id: 'balanced',
    label: 'Balanced',
    options: DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  },
  {
    id: 'maximum',
    label: 'Maximum',
    options: {
      mode: 'password',
      length: 32,
      includeLowercase: true,
      includeUppercase: true,
      includeNumbers: true,
      includeSymbols: true,
      excludeAmbiguous: false,
    },
  },
  {
    id: 'memorable',
    label: 'Memorable',
    options: {
      mode: 'passphrase',
      wordCount: 5,
      separator: '-',
      capitalizeWords: false,
      includePassphraseNumber: true,
    },
  },
  {
    id: 'legacy',
    label: 'Legacy safe',
    options: {
      mode: 'password',
      length: 18,
      includeLowercase: true,
      includeUppercase: true,
      includeNumbers: true,
      includeSymbols: false,
      excludeAmbiguous: true,
    },
  },
]

function SwitchRow({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  )
}

export function PasswordGeneratorTool({
  className,
  onUsePassword,
  showHeading = true,
}: PasswordGeneratorToolProps) {
  const [options, setOptions] = useState<PasswordGeneratorOptions>(DEFAULT_PASSWORD_GENERATOR_OPTIONS)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const strength = useMemo(() => estimatePasswordStrength(password), [password])

  function updateOptions(nextOptions: Partial<PasswordGeneratorOptions>) {
    setOptions((current) => normalisePasswordGeneratorOptions({ ...current, ...nextOptions }))
    setError(null)
  }

  function regenerate(nextOptions: PasswordGeneratorOptions = options) {
    try {
      setPassword(generatePassword(nextOptions))
      setCopied(false)
      setError(null)
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Password could not be generated.')
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        setPassword(generatePassword(DEFAULT_PASSWORD_GENERATOR_OPTIONS))
        setError(null)
      } catch (generateError) {
        setError(generateError instanceof Error ? generateError.message : 'Password could not be generated.')
      }
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [])

  async function copyPassword() {
    if (!password) {
      return
    }
    await navigator.clipboard.writeText(password)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const nextOptions = normalisePasswordGeneratorOptions({
      ...DEFAULT_PASSWORD_GENERATOR_OPTIONS,
      ...preset.options,
    })
    setOptions(nextOptions)
    regenerate(nextOptions)
  }

  const canDisableCharacterType = [
    options.includeLowercase,
    options.includeUppercase,
    options.includeNumbers,
    options.includeSymbols,
  ].filter(Boolean).length > 1

  return (
    <div className={cn('space-y-5', className)}>
      {showHeading ? (
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground" data-testid="password-generator-heading">
            <KeyRound className="size-6 text-primary" />
            Password Generator
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate passwords and passphrases locally in this browser.
          </p>
        </div>
      ) : null}

      <Card className="border-border/60 shadow-xs">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Generated secret</CardTitle>
              <CardDescription>Nothing is sent to the server while generating or copying.</CardDescription>
            </div>
            <Badge
              variant={strength.score >= 2 ? 'default' : strength.score === 1 ? 'secondary' : 'destructive'}
              data-testid="password-generator-strength"
            >
              {strength.label} · {strength.entropyBits} bits
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={password}
              readOnly
              className="font-mono"
              data-testid="password-generator-output"
              aria-label="Generated password"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => regenerate()} aria-label="Generate password">
                <RefreshCcw className="size-4" />
                Generate
              </Button>
              <Button type="button" variant="outline" onClick={() => void copyPassword()} aria-label="Copy password">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {onUsePassword ? (
                <Button type="button" onClick={() => onUsePassword(password)} disabled={!password}>
                  Use password
                </Button>
              ) : null}
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card className="border-border/60 shadow-xs">
          <CardHeader>
            <CardTitle>Presets</CardTitle>
            <CardDescription>Start from a policy-friendly default, then tune it.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => applyPreset(preset)}
              >
                <Dices className="size-4" />
                {preset.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-xs">
          <CardHeader>
            <CardTitle>Options</CardTitle>
            <CardDescription>Use character passwords for systems, passphrases for humans.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Tabs value={options.mode} onValueChange={(value) => updateOptions({ mode: value as PasswordGeneratorMode })}>
              <TabsList>
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="passphrase">Passphrase</TabsTrigger>
              </TabsList>
            </Tabs>

            {options.mode === 'password' ? (
              <div className="space-y-5">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password-generator-length">Password length</Label>
                    <Input
                      id="password-generator-length"
                      type="number"
                      min={8}
                      max={128}
                      value={options.length}
                      onChange={(event) => updateOptions({ length: Number.parseInt(event.target.value, 10) })}
                      className="w-24"
                    />
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={128}
                    value={options.length}
                    onChange={(event) => updateOptions({ length: Number.parseInt(event.target.value, 10) })}
                    aria-label="Password length slider"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <SwitchRow
                    label="Lowercase"
                    checked={options.includeLowercase}
                    disabled={options.includeLowercase && !canDisableCharacterType}
                    onCheckedChange={(checked) => updateOptions({ includeLowercase: checked })}
                  />
                  <SwitchRow
                    label="Uppercase"
                    checked={options.includeUppercase}
                    disabled={options.includeUppercase && !canDisableCharacterType}
                    onCheckedChange={(checked) => updateOptions({ includeUppercase: checked })}
                  />
                  <SwitchRow
                    label="Numbers"
                    checked={options.includeNumbers}
                    disabled={options.includeNumbers && !canDisableCharacterType}
                    onCheckedChange={(checked) => updateOptions({ includeNumbers: checked })}
                  />
                  <SwitchRow
                    label="Symbols"
                    checked={options.includeSymbols}
                    disabled={options.includeSymbols && !canDisableCharacterType}
                    onCheckedChange={(checked) => updateOptions({ includeSymbols: checked })}
                  />
                  <SwitchRow
                    label="Avoid ambiguous characters"
                    checked={options.excludeAmbiguous}
                    onCheckedChange={(checked) => updateOptions({ excludeAmbiguous: checked })}
                  />
                </div>

                {options.includeSymbols ? (
                  <div className="grid gap-2">
                    <Label htmlFor="password-generator-symbols">Allowed symbols</Label>
                    <Input
                      id="password-generator-symbols"
                      value={options.customSymbols}
                      onChange={(event) => updateOptions({ customSymbols: event.target.value })}
                      className="font-mono"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="password-generator-word-count">Word count</Label>
                    <Input
                      id="password-generator-word-count"
                      type="number"
                      min={3}
                      max={10}
                      value={options.wordCount}
                      onChange={(event) => updateOptions({ wordCount: Number.parseInt(event.target.value, 10) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-generator-separator">Separator</Label>
                    <Input
                      id="password-generator-separator"
                      value={options.separator}
                      maxLength={3}
                      onChange={(event) => updateOptions({ separator: event.target.value })}
                    />
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2 sm:grid-cols-2">
                  <SwitchRow
                    label="Capitalize words"
                    checked={options.capitalizeWords}
                    onCheckedChange={(checked) => updateOptions({ capitalizeWords: checked })}
                  />
                  <SwitchRow
                    label="Append number"
                    checked={options.includePassphraseNumber}
                    onCheckedChange={(checked) => updateOptions({ includePassphraseNumber: checked })}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
