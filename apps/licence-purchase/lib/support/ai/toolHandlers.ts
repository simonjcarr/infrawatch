import { readFile, searchCode } from './github'
import { getCustomerContext } from './scopedReader'

export type ToolResult = { content: string; is_error?: boolean }

export async function handleTool(
  name: string,
  input: unknown,
  ctx: { orgId: string },
): Promise<ToolResult> {
  const summary = summariseInput(name, input)
  const started = Date.now()
  try {
    switch (name) {
      case 'search_code': {
        const query = extractString(input, 'query')
        const hits = await searchCode(query)
        logOk(name, summary, started, `${hits.length} hits`)
        return { content: JSON.stringify(hits) }
      }
      case 'read_file': {
        const path = extractString(input, 'path')
        const file = await readFile(path)
        logOk(name, summary, started, `${file.content.length} chars`)
        return { content: `# ${file.path}\n\n${file.content}` }
      }
      case 'get_customer_context': {
        const ctxData = await getCustomerContext(ctx.orgId)
        logOk(name, summary, started, ctxData.tier)
        return { content: JSON.stringify(ctxData) }
      }
      default:
        logErr(name, summary, started, `unknown tool`)
        return { content: `Unknown tool: ${name}`, is_error: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logErr(name, summary, started, msg)
    return { content: msg, is_error: true }
  }
}

function summariseInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const rec = input as Record<string, unknown>
  if (name === 'search_code' && typeof rec.query === 'string') return `query=${JSON.stringify(rec.query)}`
  if (name === 'read_file' && typeof rec.path === 'string') return `path=${rec.path}`
  return ''
}

function logOk(name: string, summary: string, started: number, detail: string): void {
  const ms = Date.now() - started
  console.log(`[support.ai.tool] ok ${name} ${summary} → ${detail} (${ms}ms)`)
}

function logErr(name: string, summary: string, started: number, detail: string): void {
  const ms = Date.now() - started
  console.error(`[support.ai.tool] ERR ${name} ${summary} → ${detail} (${ms}ms)`)
}

function extractString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') throw new Error(`Expected object input for ${key}`)
  const v = (input as Record<string, unknown>)[key]
  if (typeof v !== 'string') throw new Error(`Expected string for ${key}`)
  return v
}
