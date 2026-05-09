import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const realFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = realFetch
})

test('resolveAgentBinary rejects GitHub assets that do not match release checksums', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-ops-agent-binary-'))
  process.env.AGENT_DIST_DIR = tempDir

  const trusted = Buffer.from('trusted-agent-binary')
  const tampered = Buffer.from('tampered-agent-binary')
  const trustedSha256 = sha256(trusted)
  const tamperedSha256 = sha256(tampered)
  const sidecar = `${trustedSha256}  ct-ops-agent-linux-amd64\n`

  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/releases?')) {
      return jsonResponse([
        releasePayload('agent/v0.33.0', trusted, trustedSha256, sidecar),
      ])
    }
    if (href.includes('/releases/tags/')) {
      return jsonResponse(releasePayload('agent/v0.33.0', trusted, trustedSha256, sidecar))
    }
    if (href.endsWith('.sha256')) {
      return textResponse(sidecar)
    }
    return new Response(tampered, {
      status: 200,
      headers: { 'content-length': String(tampered.byteLength) },
    })
  }

  const { resolveAgentBinary } = await import(`./binary.ts?tampered=${Date.now()}`)

  assert.equal(await resolveAgentBinary('linux', 'amd64'), null)
  assert.notEqual(trustedSha256, tamperedSha256)
})

test('resolveAgentBinary revalidates cached bytes before serving them', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-ops-agent-binary-'))
  process.env.AGENT_DIST_DIR = tempDir

  const stale = Buffer.from('stale-cached-agent')
  const trusted = Buffer.from('trusted-agent-binary')
  const trustedSha256 = sha256(trusted)
  const sidecar = `${trustedSha256}  ct-ops-agent-linux-amd64\n`

  await fs.writeFile(path.join(tempDir, 'ct-ops-agent-linux-amd64-v0.33.0'), stale)

  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/releases?')) {
      return jsonResponse([
        releasePayload('agent/v0.33.0', trusted, trustedSha256, sidecar),
      ])
    }
    if (href.includes('/releases/tags/')) {
      return jsonResponse(releasePayload('agent/v0.33.0', trusted, trustedSha256, sidecar))
    }
    if (href.endsWith('.sha256')) {
      return textResponse(sidecar)
    }
    return new Response(trusted, {
      status: 200,
      headers: { 'content-length': String(trusted.byteLength) },
    })
  }

  const { resolveAgentBinary } = await import(`./binary.ts?cache=${Date.now()}`)

  const binary = await resolveAgentBinary('linux', 'amd64')

  assert.equal(binary?.bytes.toString(), 'trusted-agent-binary')
})

test('resolveAgentBinary prefers the latest agent release over the baked manifest version', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-ops-agent-binary-'))
  process.env.AGENT_DIST_DIR = tempDir

  const latest = Buffer.from('latest-agent-binary')
  const latestSha256 = sha256(latest)
  const sidecar = `${latestSha256}  ct-ops-agent-linux-amd64\n`
  let requiredTagRequests = 0

  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/releases?')) {
      return jsonResponse([
        releasePayload('agent/v9.9.9', latest, latestSha256, sidecar),
      ])
    }
    if (href.includes('/releases/tags/')) {
      requiredTagRequests += 1
      return new Response('not found', { status: 404 })
    }
    if (href.endsWith('.sha256')) {
      return textResponse(sidecar)
    }
    return new Response(latest, {
      status: 200,
      headers: { 'content-length': String(latest.byteLength) },
    })
  }

  const { resolveAgentBinary } = await import(`./binary.ts?latest=${Date.now()}`)

  const binary = await resolveAgentBinary('linux', 'amd64')
  const cached = await fs.readFile(path.join(tempDir, 'ct-ops-agent-linux-amd64-v9.9.9'))

  assert.equal(binary?.bytes.toString(), 'latest-agent-binary')
  assert.equal(cached.toString(), 'latest-agent-binary')
  assert.equal(requiredTagRequests, 0)
})

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
}

function releasePayload(tagName, binary, binarySha256, sidecar) {
  return {
    tag_name: tagName,
    assets: [
      {
        name: 'ct-ops-agent-linux-amd64',
        browser_download_url: 'https://downloads.example.com/ct-ops-agent-linux-amd64',
        digest: `sha256:${binarySha256}`,
        size: binary.byteLength,
      },
      {
        name: 'ct-ops-agent-linux-amd64.sha256',
        browser_download_url: 'https://downloads.example.com/ct-ops-agent-linux-amd64.sha256',
        digest: `sha256:${sha256(Buffer.from(sidecar))}`,
        size: Buffer.byteLength(sidecar),
      },
    ],
  }
}
