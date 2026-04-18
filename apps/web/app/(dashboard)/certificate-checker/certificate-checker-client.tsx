'use client'

import { useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import {
  Upload,
  Globe,
  Key,
  Download,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  FileText,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ParsedCertificate, CertCheckerResponse } from '@/app/api/tools/certificate-checker/route'

// ─── Utility helpers ─────────────────────────────────────────────────────────

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button variant="ghost" size="icon" className={`size-6 shrink-0 ${className ?? ''}`} onClick={copy}>
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5 text-muted-foreground" />}
    </Button>
  )
}

function InfoRow({ label, value, mono = false, copyable = false }: {
  label: string
  value: string | null | undefined
  mono?: boolean
  copyable?: boolean
}) {
  if (!value) return null
  return (
    <>
      <dt className="text-muted-foreground font-medium text-sm">{label}</dt>
      <dd className={`text-sm break-all flex items-start gap-1 ${mono ? 'font-mono' : ''}`}>
        <span className="flex-1">{value}</span>
        {copyable && <CopyButton value={value} className="mt-[-2px]" />}
      </dd>
    </>
  )
}

function StatusBadge({ cert }: { cert: ParsedCertificate }) {
  if (cert.isExpired)
    return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100"><ShieldX className="size-3 mr-1" />Expired</Badge>
  if (cert.isExpiringSoon)
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100"><ShieldAlert className="size-3 mr-1" />Expiring Soon</Badge>
  return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100"><ShieldCheck className="size-3 mr-1" />Valid</Badge>
}

function Section({ title, children, defaultOpen = true }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card>
      <CardHeader
        className="pb-2 cursor-pointer select-none flex flex-row items-center justify-between"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  )
}

// ─── File + Paste input ───────────────────────────────────────────────────────

interface FileOrPasteInputProps {
  id: string
  label: string
  sublabel?: string
  accept: string
  placeholder: string
  file: File | null
  text: string
  onFile: (f: File | null) => void
  onText: (t: string) => void
}

function FileOrPasteInput({ id, label, sublabel, accept, placeholder, file, text, onFile, onText }: FileOrPasteInputProps) {
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const f = files[0]!
    // If it looks like a text/PEM file, read it and populate the textarea
    if (f.name.match(/\.(pem|crt|cer|key)$/i) || f.type === 'text/plain') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        if (result.includes('-----BEGIN')) {
          onFile(null)
          onText(result.trim())
          return
        }
        onText('')
        onFile(f)
      }
      reader.readAsText(f)
    } else {
      onText('')
      onFile(f)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasContent = file !== null || text.trim() !== ''

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
      </div>

      {/* Drop zone */}
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer
          ${dragging ? 'border-primary bg-primary/5' : hasContent ? 'border-muted-foreground/40 bg-muted/30' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={accept}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {file ? (
          <div className="flex items-center gap-2 px-4 py-3">
            <FileText className="size-4 text-muted-foreground shrink-0" />
            <span className="text-sm truncate flex-1">{file.name}</span>
            <button
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={(e) => { e.stopPropagation(); onFile(null); if (fileRef.current) fileRef.current.value = '' }}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-3 px-4 text-center">
            <Upload className="size-4 text-muted-foreground/60 shrink-0" />
            <span className="text-xs text-muted-foreground">Drop file here or click to browse</span>
          </div>
        )}
      </div>

      {/* Paste area — always shown; cleared when file is set */}
      <Textarea
        id={id}
        placeholder={placeholder}
        className="font-mono text-xs h-28 resize-none"
        value={file ? '' : text}
        disabled={file !== null}
        onChange={(e) => { onFile(null); onText(e.target.value) }}
        onPaste={(e) => {
          // Accept drops on the textarea too
          e.stopPropagation()
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      />
    </div>
  )
}

// ─── Certificate results display ─────────────────────────────────────────────

function CertificateResults({ cert, keyMatch, onDownload }: {
  cert: ParsedCertificate
  keyMatch?: boolean
  onDownload: (format: 'pem' | 'der' | 'pkcs7') => void
}) {
  const daysAbs = Math.abs(cert.daysRemaining)
  const expiryLabel = cert.isExpired
    ? `Expired ${daysAbs} day${daysAbs !== 1 ? 's' : ''} ago`
    : `${daysAbs} day${daysAbs !== 1 ? 's' : ''} remaining`

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-semibold">{cert.commonName || cert.subject}</h2>
            <StatusBadge cert={cert} />
            {cert.isSelfSigned && <Badge variant="outline" className="text-xs">Self-Signed</Badge>}
            {cert.isCA && <Badge variant="outline" className="text-xs">CA Certificate</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{cert.subject}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-4 mr-2" />
              Download
              <ChevronDown className="size-3 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onDownload('pem')}>
              <FileText className="size-4 mr-2" />PEM (.pem / .crt)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload('der')}>
              <FileText className="size-4 mr-2" />DER (.der)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload('pkcs7')}>
              <FileText className="size-4 mr-2" />PKCS#7 (.p7b)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Valid From</p>
          <p className="text-sm font-medium mt-0.5">{format(new Date(cert.notBefore), 'MMM d, yyyy')}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(cert.notBefore), 'HH:mm:ss z')}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Expires</p>
          <p className={`text-sm font-medium mt-0.5 ${cert.isExpired ? 'text-red-600' : cert.isExpiringSoon ? 'text-amber-600' : ''}`}>
            {format(new Date(cert.notAfter), 'MMM d, yyyy')}
          </p>
          <p className="text-xs text-muted-foreground">{expiryLabel}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Key</p>
          <p className="text-sm font-medium mt-0.5">
            {cert.keyAlgorithm}{cert.keySize ? ` ${cert.keySize}-bit` : ''}{cert.curve ? ` (${cert.curve})` : ''}
          </p>
          <p className="text-xs text-muted-foreground">{cert.signatureAlgorithm}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Issuer</p>
          <p className="text-sm font-medium mt-0.5 truncate">{cert.issuerCommonName || cert.issuerOrganization}</p>
          <p className="text-xs text-muted-foreground truncate">{cert.issuerOrganization}</p>
        </Card>
      </div>

      {/* Key match result */}
      {keyMatch !== undefined && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium ${
          keyMatch
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {keyMatch ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
          {keyMatch ? 'Private key matches this certificate' : 'Private key does NOT match this certificate'}
        </div>
      )}

      {/* Subject */}
      <Section title="Subject">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <InfoRow label="Common Name" value={cert.commonName} copyable />
          <InfoRow label="Organization" value={cert.organization} />
          <InfoRow label="Organizational Unit" value={cert.organizationalUnit} />
          <InfoRow label="Country" value={cert.country} />
          <InfoRow label="State / Province" value={cert.state} />
          <InfoRow label="Locality" value={cert.locality} />
          <InfoRow label="Full DN" value={cert.subject} mono copyable />
        </dl>
      </Section>

      {/* Issuer */}
      <Section title="Issuer">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <InfoRow label="Common Name" value={cert.issuerCommonName} />
          <InfoRow label="Organization" value={cert.issuerOrganization} />
          <InfoRow label="Full DN" value={cert.issuer} mono copyable />
        </dl>
      </Section>

      {/* Validity & fingerprints */}
      <Section title="Validity & Fingerprints">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <InfoRow label="Not Before" value={format(new Date(cert.notBefore), "MMM d, yyyy HH:mm:ss 'UTC'")} />
          <InfoRow label="Not After" value={format(new Date(cert.notAfter), "MMM d, yyyy HH:mm:ss 'UTC'")} />
          <InfoRow label="Serial Number" value={cert.serialNumber} mono copyable />
          <InfoRow label="SHA-1 Fingerprint" value={cert.fingerprintSha1} mono copyable />
          <InfoRow label="SHA-256 Fingerprint" value={cert.fingerprintSha256} mono copyable />
          <InfoRow label="SHA-512 Fingerprint" value={cert.fingerprintSha512} mono copyable />
        </dl>
      </Section>

      {/* Key & algorithm */}
      <Section title="Key & Algorithm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <InfoRow label="Key Algorithm" value={cert.keyAlgorithm} />
          <InfoRow label="Key Size" value={cert.keySize ? `${cert.keySize} bits` : null} />
          <InfoRow label="Curve" value={cert.curve} />
          <InfoRow label="Signature Algorithm" value={cert.signatureAlgorithm} />
          <InfoRow label="Subject Key ID" value={cert.subjectKeyId} mono copyable />
          <InfoRow label="Authority Key ID" value={cert.authorityKeyId} mono copyable />
        </dl>
      </Section>

      {/* Extensions */}
      <Section title="Extensions">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <InfoRow label="Is CA" value={cert.isCA ? 'Yes' : 'No'} />
          {cert.pathLength !== null && <InfoRow label="Path Length" value={String(cert.pathLength)} />}
          <InfoRow label="Self-Signed" value={cert.isSelfSigned ? 'Yes' : 'No'} />
        </dl>
        {cert.keyUsage.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground font-medium mb-1.5">Key Usage</p>
            <div className="flex flex-wrap gap-1.5">
              {cert.keyUsage.map((u) => <Badge key={u} variant="secondary" className="text-xs">{u}</Badge>)}
            </div>
          </div>
        )}
        {cert.extendedKeyUsage.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground font-medium mb-1.5">Extended Key Usage</p>
            <div className="flex flex-wrap gap-1.5">
              {cert.extendedKeyUsage.map((u) => <Badge key={u} variant="secondary" className="text-xs">{u}</Badge>)}
            </div>
          </div>
        )}
        {cert.certificatePolicies.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground font-medium mb-1.5">Certificate Policies</p>
            <div className="flex flex-wrap gap-1.5">
              {cert.certificatePolicies.map((p) => <Badge key={p} variant="outline" className="text-xs font-mono">{p}</Badge>)}
            </div>
          </div>
        )}
      </Section>

      {/* SANs */}
      {cert.sans.length > 0 && (
        <Section title={`Subject Alternative Names (${cert.sans.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {cert.sans.map((san, i) => (
              <Badge key={i} variant="secondary" className="font-mono text-xs">
                <span className="text-muted-foreground mr-1">{san.type}:</span>
                {san.value}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {/* Revocation info */}
      {(cert.ocspUrls.length > 0 || cert.caIssuers.length > 0 || cert.crlUrls.length > 0) && (
        <Section title="Revocation & Authority Info">
          <dl className="space-y-2">
            {cert.ocspUrls.map((u, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-x-6">
                <dt className="text-muted-foreground font-medium text-sm">OCSP</dt>
                <dd className="text-sm font-mono break-all">{u}</dd>
              </div>
            ))}
            {cert.caIssuers.map((u, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-x-6">
                <dt className="text-muted-foreground font-medium text-sm">CA Issuer</dt>
                <dd className="text-sm font-mono break-all">{u}</dd>
              </div>
            ))}
            {cert.crlUrls.map((u, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-x-6">
                <dt className="text-muted-foreground font-medium text-sm">CRL</dt>
                <dd className="text-sm font-mono break-all">{u}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {/* Chain */}
      {cert.chain.length > 1 && (
        <Section title={`Certificate Chain (${cert.chain.length} certificates)`}>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Issuer</TableHead>
                  <TableHead>Valid Until</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cert.chain.map((entry, i) => {
                  const expired = new Date(entry.notAfter) < new Date()
                  return (
                    <TableRow key={entry.fingerprintSha256}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs max-w-52 truncate">{entry.subject}</TableCell>
                      <TableCell className="font-mono text-xs max-w-52 truncate">{entry.issuer}</TableCell>
                      <TableCell className={`text-sm ${expired ? 'text-red-600' : ''}`}>
                        {format(new Date(entry.notAfter), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        {entry.isCA
                          ? <Badge variant="outline" className="text-xs">CA</Badge>
                          : <Badge variant="secondary" className="text-xs">End Entity</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      {/* Raw PEM */}
      <Section title="PEM" defaultOpen={false}>
        <div className="relative">
          <pre className="text-xs font-mono bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {cert.pem}
          </pre>
          <CopyButton value={cert.pem} className="absolute top-2 right-2 bg-background border size-7" />
        </div>
      </Section>
    </div>
  )
}

// ─── Shared key input (used in both tabs) ────────────────────────────────────

function KeyInput({ keyFile, keyText, onKeyFile, onKeyText }: {
  keyFile: File | null
  keyText: string
  onKeyFile: (f: File | null) => void
  onKeyText: (t: string) => void
}) {
  return (
    <div className="border-t pt-4 mt-2">
      <FileOrPasteInput
        id="key-input"
        label="Private Key"
        sublabel="optional — validates key matches certificate"
        accept=".pem,.key,.txt"
        placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
        file={keyFile}
        text={keyText}
        onFile={onKeyFile}
        onText={onKeyText}
      />
    </div>
  )
}

// ─── Upload tab ───────────────────────────────────────────────────────────────

function UploadTab({ onResult }: { onResult: (cert: ParsedCertificate, keyMatch?: boolean) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certText, setCertText] = useState('')
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [keyText, setKeyText] = useState('')
  const [password, setPassword] = useState('')

  const isPfx = certFile?.name.match(/\.(pfx|p12)$/i)
  const hasCert = certFile !== null || certText.trim() !== ''

  async function submit() {
    if (!hasCert) return
    setLoading(true)
    setError(null)
    try {
      let body: Record<string, unknown>

      if (certText.trim()) {
        body = { action: 'parse', pemText: certText.trim(), password: password || undefined }
      } else {
        const buf = await certFile!.arrayBuffer()
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        body = { action: 'parse', data: b64, password: password || undefined }
      }

      // Attach key if provided
      const resolvedKey = keyText.trim() || (keyFile ? await readFileAsText(keyFile) : undefined)
      if (resolvedKey) body.keyPem = resolvedKey

      const res = await fetch('/api/tools/certificate-checker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json: CertCheckerResponse = await res.json()
      if (!json.ok) { setError(json.error); return }
      onResult(json.certificate, json.keyMatch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <FileOrPasteInput
        id="cert-input"
        label="Certificate"
        accept=".pem,.crt,.cer,.der,.p7b,.p7c,.pfx,.p12"
        placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
        file={certFile}
        text={certText}
        onFile={setCertFile}
        onText={setCertText}
      />

      {(isPfx || password) && (
        <div className="space-y-1.5">
          <Label htmlFor="cert-password">Password {isPfx ? '(required for .pfx/.p12)' : '(optional)'}</Label>
          <Input
            id="cert-password"
            type="password"
            placeholder="Certificate password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}

      <KeyInput
        keyFile={keyFile}
        keyText={keyText}
        onKeyFile={setKeyFile}
        onKeyText={setKeyText}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Button className="w-full" disabled={!hasCert || loading} onClick={submit}>
        {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}
        {loading ? 'Parsing...' : 'Analyse Certificate'}
      </Button>
    </div>
  )
}

// ─── URL tab ──────────────────────────────────────────────────────────────────

function UrlTab({ onResult }: { onResult: (cert: ParsedCertificate, keyMatch?: boolean) => void }) {
  const [url, setUrl] = useState('')
  const [port, setPort] = useState('443')
  const [servername, setServername] = useState('')
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [keyText, setKeyText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const resolvedKey = keyText.trim() || (keyFile ? await readFileAsText(keyFile) : undefined)
      const res = await fetch('/api/tools/certificate-checker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fetch-url',
          url: url.trim(),
          port: port ? parseInt(port, 10) : 443,
          servername: servername.trim() || undefined,
          keyPem: resolvedKey || undefined,
        }),
      })
      const json: CertCheckerResponse = await res.json()
      if (!json.ok) { setError(json.error); return }
      onResult(json.certificate, json.keyMatch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cert-url">Hostname or URL</Label>
        <Input
          id="cert-url"
          placeholder="example.com or https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cert-port">Port</Label>
          <Input
            id="cert-port"
            type="number"
            min={1}
            max={65535}
            placeholder="443"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cert-sni">SNI Override <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            id="cert-sni"
            placeholder="Same as hostname"
            value={servername}
            onChange={(e) => setServername(e.target.value)}
          />
        </div>
      </div>

      <KeyInput
        keyFile={keyFile}
        keyText={keyText}
        onKeyFile={setKeyFile}
        onKeyText={setKeyText}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Button className="w-full" disabled={!url.trim() || loading} onClick={submit}>
        {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Globe className="size-4 mr-2" />}
        {loading ? 'Fetching...' : 'Fetch Certificate'}
      </Button>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve((e.target?.result as string) ?? '')
    reader.onerror = reject
    reader.readAsText(file)
  })
}

// ─── Main page component ──────────────────────────────────────────────────────

export function CertificateCheckerClient() {
  const [cert, setCert] = useState<ParsedCertificate | null>(null)
  const [keyMatch, setKeyMatch] = useState<boolean | undefined>(undefined)

  function handleResult(c: ParsedCertificate, km?: boolean) {
    setCert(c)
    setKeyMatch(km)
  }

  async function handleDownload(fmt: 'pem' | 'der' | 'pkcs7') {
    if (!cert) return
    const res = await fetch('/api/tools/certificate-checker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download', certPem: cert.pem, format: fmt }),
    })
    const blob = await res.blob()
    const ext = { pem: '.pem', der: '.der', pkcs7: '.p7b' }[fmt]
    const name = `${cert.commonName.replace(/[^a-z0-9.-]/gi, '_') || 'certificate'}${ext}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  function reset() {
    setCert(null)
    setKeyMatch(undefined)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">SSL Certificate Checker</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Inspect, validate, and convert X.509 certificates from files or live endpoints.
          </p>
        </div>
        {cert && (
          <Button variant="outline" size="sm" onClick={reset}>
            <X className="size-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

      {/* Input panel */}
      <Card>
        <CardContent className="pt-5">
          <Tabs defaultValue="upload">
            <TabsList className="mb-4">
              <TabsTrigger value="upload">
                <Upload className="size-4 mr-2" />
                Upload / Paste
              </TabsTrigger>
              <TabsTrigger value="url">
                <Globe className="size-4 mr-2" />
                Check URL
              </TabsTrigger>
            </TabsList>
            <TabsContent value="upload">
              <UploadTab onResult={handleResult} />
            </TabsContent>
            <TabsContent value="url">
              <UrlTab onResult={handleResult} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {cert ? (
        <CertificateResults cert={cert} keyMatch={keyMatch} onDownload={handleDownload} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <ShieldCheck className="size-16 mb-4 opacity-20" />
          <p className="font-medium">No certificate loaded</p>
          <p className="text-sm mt-1">Upload a certificate file, paste PEM text, or enter a URL above to begin.</p>
        </div>
      )}
    </div>
  )
}
