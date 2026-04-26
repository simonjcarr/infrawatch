import { readFile } from 'node:fs/promises'

type CapturedEmail = {
  to: string
  subject: string
  text: string
  html: string
  metadata?: Record<string, string>
}

function getCaptureFile(): string {
  const file = process.env['AUTH_EMAIL_CAPTURE_FILE']
  if (!file) {
    throw new Error('AUTH_EMAIL_CAPTURE_FILE is not set')
  }
  return file
}

export async function waitForVerificationUrl(to: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const file = getCaptureFile()

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(file, 'utf8')
      const messages = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CapturedEmail)

      const match = [...messages].reverse().find((message) => message.to === to)
      const verificationUrl = match?.metadata?.verificationUrl
      if (verificationUrl) return verificationUrl
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`Timed out waiting for verification email for ${to}`)
}
