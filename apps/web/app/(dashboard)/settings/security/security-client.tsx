'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getSecurityOverview, uploadAgentCA } from '@/lib/actions/security'
import type { SecurityOverview } from '@/lib/actions/security-types'

type OverviewResult = SecurityOverview | { error: string }

interface Props {
  initialOverview: OverviewResult
}

function shortenFingerprint(fp: string): string {
  if (fp.length <= 19) return fp
  return fp.slice(0, 8) + '…' + fp.slice(-8)
}

function formatIsoDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function SecuritySettingsClient({ initialOverview }: Props) {
  const queryClient = useQueryClient()
  const [certPem, setCertPem] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadOk, setUploadOk] = useState<string | null>(null)

  const { data = initialOverview } = useQuery<OverviewResult>({
    queryKey: ['security-overview'],
    queryFn: getSecurityOverview,
    initialData: initialOverview,
  })

  const uploadMutation = useMutation({
    mutationFn: () => uploadAgentCA({ certPem, keyPem }),
    onSuccess: (res) => {
      if ('error' in res) {
        setUploadError(res.error)
        setUploadOk(null)
      } else {
        setUploadError(null)
        setUploadOk(`Uploaded. Fingerprint: ${shortenFingerprint(res.fingerprint)}`)
        setCertPem('')
        setKeyPem('')
        void queryClient.invalidateQueries({ queryKey: ['security-overview'] })
      }
    },
    onError: (err) => {
      setUploadError(err instanceof Error ? err.message : String(err))
      setUploadOk(null)
    },
  })

  if ('error' in data) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Failed to load security settings</AlertTitle>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="size-6" />
          Security — mTLS &amp; Agent CA
        </h1>
        <p className="text-muted-foreground mt-1">
          All agent ↔ server gRPC traffic is authenticated with mutual TLS. The
          server auto-generates an internal CA on first boot if none is supplied.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Server TLS certificate</CardTitle>
          <CardDescription>
            What agents validate when dialling the ingest service. Provide your
            own via <code>INGEST_TLS_CERT</code> / <code>INGEST_TLS_KEY</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.serverTls ? (
            <dl className="grid grid-cols-[140px,1fr] gap-y-1">
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="font-mono text-xs">{data.serverTls.subject}</dd>
              <dt className="text-muted-foreground">Issuer</dt>
              <dd className="font-mono text-xs">{data.serverTls.issuer}</dd>
              <dt className="text-muted-foreground">Valid from</dt>
              <dd>{formatIsoDate(data.serverTls.notBefore)}</dd>
              <dt className="text-muted-foreground">Valid to</dt>
              <dd>{formatIsoDate(data.serverTls.notAfter)}</dd>
              <dt className="text-muted-foreground">SHA-256</dt>
              <dd className="font-mono text-xs break-all">{data.serverTls.fingerprintSha256}</dd>
              <dt className="text-muted-foreground">Source file</dt>
              <dd className="font-mono text-xs">{data.serverTls.certFile}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">Server TLS cert not readable from this container.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent CA</CardTitle>
          <CardDescription>
            Signs per-agent client certificates. Auto-generated on first boot
            unless overridden via <code>INGEST_AGENT_CA_CERT</code> / <code>INGEST_AGENT_CA_KEY</code>
            {' '}or a BYO upload below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.agentCa ? (
            <>
              <div className="flex gap-2 items-center">
                <Badge variant={data.agentCa.source === 'byo' ? 'default' : 'secondary'}>
                  {data.agentCa.source === 'byo' ? 'Customer-provided' : 'Auto-generated'}
                </Badge>
                {data.agentCa.byoEnvConfigured && (
                  <Badge variant="outline">Env-file override active</Badge>
                )}
              </div>
              <dl className="grid grid-cols-[140px,1fr] gap-y-1 mt-2">
                <dt className="text-muted-foreground">Subject</dt>
                <dd className="font-mono text-xs">{data.agentCa.subject}</dd>
                <dt className="text-muted-foreground">Issuer</dt>
                <dd className="font-mono text-xs">{data.agentCa.issuer}</dd>
                <dt className="text-muted-foreground">Valid from</dt>
                <dd>{formatIsoDate(data.agentCa.notBefore)}</dd>
                <dt className="text-muted-foreground">Valid to</dt>
                <dd>{formatIsoDate(data.agentCa.notAfter)}</dd>
                <dt className="text-muted-foreground">SHA-256</dt>
                <dd className="font-mono text-xs break-all">{data.agentCa.fingerprintSha256}</dd>
              </dl>
            </>
          ) : (
            <p className="text-muted-foreground">No agent CA loaded yet. Start the ingest service to auto-generate one.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload a custom CA</CardTitle>
          <CardDescription>
            Replaces the auto-generated CA. Existing client certificates remain
            valid until expiry; new enrolments are signed by the uploaded CA.
            Admins who want a clean cut-over should revoke affected agents and
            re-enrol them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="cert-pem">CA certificate (PEM)</Label>
            <Textarea
              id="cert-pem"
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----..."
              rows={8}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="key-pem">CA private key (PEM)</Label>
            <Textarea
              id="key-pem"
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              placeholder="-----BEGIN EC PRIVATE KEY-----..."
              rows={8}
              className="font-mono text-xs"
            />
          </div>
          {uploadError && (
            <Alert variant="destructive">
              <AlertTitle>Upload failed</AlertTitle>
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}
          {uploadOk && (
            <Alert>
              <AlertTitle>Upload successful</AlertTitle>
              <AlertDescription>{uploadOk}</AlertDescription>
            </Alert>
          )}
          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={uploadMutation.isPending || !certPem.trim() || !keyPem.trim()}
          >
            <Upload className="size-4 mr-2" />
            {uploadMutation.isPending ? 'Uploading…' : 'Upload CA'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
