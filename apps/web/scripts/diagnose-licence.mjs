#!/usr/bin/env node
// Diagnostic: decode a licence JWT and attempt signature verification with
// both the dev and prod public keys embedded in apps/web/lib/licence.ts.
// Prints exactly which claim or signature check fails so we can tell whether
// the problem is a key mismatch, an issuer/audience mismatch, or something
// else.
//
// Usage:
//   node apps/web/scripts/diagnose-licence.mjs '<jwt>'
//   cat licence.jwt | node apps/web/scripts/diagnose-licence.mjs

import { readFileSync } from 'node:fs'
import { importSPKI, jwtVerify } from 'jose'

const PROD_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs7wCpDYBtABdwlkDe5Vq
ATSc3vjvPMvRZouJrvsg/DxWTUMYbvVvhaICXZjgDDl7ztrIS+jvM4SfGfrArQpu
CxrmYRYITpZ8t71XDccmIKxBypxVupFtm1JiF6oLIWknKcLV4g2SLvep5YQLhSQq
ebJdEjJtGbao9oWdLfDhnmKjSGTwGjX6jJysGhGWm0YpTNaGPZ81OcvlBHweTX34
g/In9Js5u7oieD3+aY6JKMF65tnnswRS8Psj5UHtOeAc7GOR193EVEczgEQ95o37
Uol9h/Lzyomiz808xOIWvemZLeT3DzeeNDcT4GOpKt8aIr+CQ8nsZk9wggd6aWnk
XwIDAQAB
-----END PUBLIC KEY-----`

const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz/pW3tGLo8e//f75eVk3
pNM/S9CPBYozjgSRDxppJQIr2JPTI4tM9jd4Of1i0/MYfighpTSilDtUGgI6Q6Z9
8hs5aBFT/N63BanMwsAlqGHRZ/igJSWu5HhBuWR2CtKIpIqGcel32uAyGDnTjfKu
iYswa0tn+/Q2KxX7HF6aoNAH0CH333sa88QxNCRCKvj/Byqqdma/VTp7Gj50JdSP
YvAIzi0rDcPBMRFMGm6M7n6lwN/XCPgdXEAzI2z+/PiBAK3suh3jyaxtD0D4FHdt
/Iyxxs/zZsceZIpjDcyVbd1JJ6Y3DumbgAPqajnMNSVkniYWG7Q37DfsYNtk6/DT
EQIDAQAB
-----END PUBLIC KEY-----`

const EXPECTED_ISS = 'licence.carrtech.dev'
const EXPECTED_AUD = 'install.carrtech.dev'

function readJwtInput() {
  const arg = process.argv[2]
  if (arg && arg !== '-') return arg.trim()
  const stdin = readFileSync(0, 'utf8').trim()
  if (stdin) return stdin
  throw new Error('Pass the licence JWT as the first arg, or pipe it on stdin.')
}

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
}

async function verifyWith(label, pem, jwt) {
  try {
    const key = await importSPKI(pem, 'RS256')
    const { payload } = await jwtVerify(jwt, key, {
      algorithms: ['RS256'],
      issuer: EXPECTED_ISS,
      audience: EXPECTED_AUD,
    })
    console.log(`  [${label}] OK — signature valid and iss/aud match`)
    return { ok: true, payload }
  } catch (err) {
    console.log(`  [${label}] FAILED — ${err?.code ?? ''} ${err?.message ?? err}`)
    return { ok: false }
  }
}

async function main() {
  const jwt = readJwtInput()
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    console.error('Not a JWT — expected 3 dot-separated segments, got', parts.length)
    process.exit(2)
  }

  const header = decodeSegment(parts[0])
  const payload = decodeSegment(parts[1])

  console.log('--- Header ---')
  console.log(header)
  console.log('--- Payload ---')
  console.log(payload)

  const now = Math.floor(Date.now() / 1000)
  console.log('--- Claim checks ---')
  console.log(`  alg        : ${header.alg === 'RS256' ? 'OK' : 'WRONG (' + header.alg + ')'}`)
  console.log(`  iss        : ${payload.iss === EXPECTED_ISS ? 'OK' : `MISMATCH (got "${payload.iss}", expected "${EXPECTED_ISS}")`}`)
  console.log(`  aud        : ${payload.aud === EXPECTED_AUD ? 'OK' : `MISMATCH (got "${payload.aud}", expected "${EXPECTED_AUD}")`}`)
  console.log(`  exp        : ${payload.exp > now ? `OK (${payload.exp - now}s remaining)` : 'EXPIRED'}`)
  console.log(`  nbf        : ${!payload.nbf || payload.nbf <= now ? 'OK' : 'NOT YET VALID'}`)
  console.log(`  tier       : ${payload.tier}`)
  console.log(`  features   : ${JSON.stringify(payload.features)}`)
  console.log(`  maxUsers   : ${payload.maxUsers ?? '(unset)'}`)
  console.log(`  maxHosts   : ${payload.maxHosts ?? '(unset)'}`)

  console.log('--- Signature verification ---')
  await verifyWith('DEV public key', DEV_PUBLIC_KEY_PEM, jwt)
  await verifyWith('PROD public key', PROD_PUBLIC_KEY_PEM, jwt)

  console.log('')
  console.log('Summary:')
  console.log('  - If DEV verified OK and PROD failed → you are running apps/web in dev mode, signed with dev key. All good.')
  console.log('  - If PROD verified OK and DEV failed → the key was signed with the prod private key. Make sure apps/web is also run with NODE_ENV=production (or swap to the dev private key in licence-purchase).')
  console.log('  - If BOTH failed with signature error → the signing private key does not match either public key in apps/web/lib/licence.ts. Regenerate a pair and update the PEM block.')
  console.log('  - If BOTH failed with iss/aud error → the licence was signed before the issuer/audience fix landed. Issue a new licence.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
