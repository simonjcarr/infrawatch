import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHostDownloadScript } from './host-download-script.ts'

test('buildHostDownloadScript keeps TLS certificate validation enabled', () => {
  const script = buildHostDownloadScript({
    downloadUrl: 'https://ct-ops.example.com/api/tools/bundle-transfer?jobId=job-1&token=token-1',
    directory: '/opt/ct-ops/bundles',
    fileName: 'gitlab-18.0.0.zip',
    owner: 'deploy',
    expectedSha256: 'a'.repeat(64),
  })

  assert.match(script, /curl -fL --retry 3 --connect-timeout 20 --output "\$TMP_PATH" "\$DOWNLOAD_URL"/)
  assert.match(script, /wget --tries=3 --timeout=20 -O "\$TMP_PATH" "\$DOWNLOAD_URL"/)
  assert.equal(script.includes('curl -fLk'), false)
  assert.equal(script.includes('--no-check-certificate'), false)
})

test('buildHostDownloadScript verifies the downloaded archive before moving it into place', () => {
  const script = buildHostDownloadScript({
    downloadUrl: 'https://ct-ops.example.com/api/tools/bundle-transfer?jobId=job-1&token=token-1',
    directory: '/opt/ct-ops/bundles',
    fileName: 'gitlab-18.0.0.zip',
    owner: '',
    expectedSha256: 'b'.repeat(64),
  })

  assert.match(script, /EXPECTED_SHA256='bbbb/)
  assert.match(script, /sha256sum -c -/)
  assert.match(script, /shasum -a 256 -c -/)
  assert.match(script, /Neither sha256sum nor shasum is installed/)
  assert.ok(script.indexOf('sha256sum -c -') < script.indexOf('mv -f "$TMP_PATH" "$DEST_PATH"'))
})
