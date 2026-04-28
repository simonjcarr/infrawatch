// Produce a signed cookie value in exactly the format Hono's serializeSigned uses:
// encodeURIComponent(`${value}.${btoa(HMAC-SHA256(value, secret))}`).
// Better Auth's getSession delegates cookie verification to Hono, so this must
// match Hono's implementation byte-for-byte to avoid silent session failures.
export async function makeSessionCookieValue(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  const base64Sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return encodeURIComponent(`${token}.${base64Sig}`)
}
