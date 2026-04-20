import Anthropic from '@anthropic-ai/sdk'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  supportMessages,
  supportTickets,
} from '@/lib/db/schema'
import { env } from '@/lib/env'
import { classifyForInjection } from './moderation'
import {
  buildInitialUserContent,
  buildSystemPrompt,
  wrapCustomerText,
  type TurnMessage,
} from './prompt'
import { redactCustomerText } from './redact'
import { isUnderAiRateLimit, recordAiResponse } from './rateLimit'
import { getCustomerContext } from './scopedReader'
import { supportTools } from './tools'
import { handleTool } from './toolHandlers'

const MAX_TOOL_ITERATIONS = 8

export type RunOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'flagged'; reason: string }
  | { kind: 'replied'; messageId: string }
  | { kind: 'error'; reason: string }

export async function runAiTurn(ticketId: string): Promise<RunOutcome> {
  if (env.supportAiKillSwitch) return { kind: 'skipped', reason: 'kill-switch-env' }

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, ticketId),
  })
  if (!ticket) return { kind: 'error', reason: 'ticket-not-found' }
  if (ticket.aiPaused) return { kind: 'skipped', reason: 'ticket-paused' }

  const apiKey = env.anthropicApiKey
  if (!apiKey) return { kind: 'error', reason: 'no-anthropic-api-key' }

  if (!(await isUnderAiRateLimit(ticketId))) {
    await db
      .update(supportTickets)
      .set({
        aiPaused: true,
        aiFlagReason: 'Rate limit reached — staff will take over.',
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, ticketId))
    return { kind: 'skipped', reason: 'rate-limited' }
  }

  // Pull the message history. We only need to moderate the most recent
  // customer message — older customer messages have already been moderated on
  // prior turns (or, for the very first turn, this is that message).
  const rawMessages = await db.query.supportMessages.findMany({
    where: eq(supportMessages.ticketId, ticketId),
    orderBy: [supportMessages.createdAt],
  })

  const lastCustomer = [...rawMessages].reverse().find((m) => m.author === 'customer')
  if (!lastCustomer) return { kind: 'skipped', reason: 'no-customer-message' }

  const redactedLast = lastCustomer.bodyRedacted ?? redactCustomerText(lastCustomer.body)

  const moderation = await classifyForInjection(redactedLast)
  if (moderation.isInjection && moderation.confidence >= 0.8) {
    await db
      .update(supportTickets)
      .set({
        aiPaused: true,
        aiFlagReason: `Prompt-injection attempt detected (${moderation.category}): ${moderation.reasoning}`,
        updatedAt: new Date(),
      })
      .where(and(eq(supportTickets.id, ticketId)))
    return { kind: 'flagged', reason: moderation.reasoning }
  }

  const customerContext = await getCustomerContext(ticket.organisationId)

  const history: TurnMessage[] = rawMessages.map((m) => ({
    author: m.author as TurnMessage['author'],
    body:
      m.author === 'customer'
        ? wrapCustomerText(m.bodyRedacted ?? redactCustomerText(m.body))
        : m.body,
    createdAt: m.createdAt,
  }))

  const system = buildSystemPrompt()
  const initialUser = buildInitialUserContent({
    ticketSubject: ticket.subject,
    customerContext,
    history,
  })

  const client = new Anthropic({ apiKey })
  const started = Date.now()

  // Agentic tool loop. We re-send the full conversation each iteration with
  // accumulated tool_use / tool_result blocks until the model stops calling
  // tools.
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initialUser }]
  let finalText = ''
  let totalInput = 0
  let totalOutput = 0
  let toolErrorCount = 0
  let toolCallCount = 0
  let firstToolError: { tool: string; detail: string } | null = null

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await client.messages.create({
      model: env.supportAiModelId,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: supportTools,
      messages,
    })
    totalInput += res.usage.input_tokens
    totalOutput += res.usage.output_tokens

    const toolUses = res.content.filter(
      (b): b is Extract<Anthropic.ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    )
    const textBlocks = res.content.filter(
      (b): b is Extract<Anthropic.ContentBlock, { type: 'text' }> => b.type === 'text',
    )
    finalText = textBlocks.map((b) => b.text).join('\n').trim()

    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) break

    messages.push({ role: 'assistant', content: res.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      toolCallCount += 1
      const r = await handleTool(tu.name, tu.input, { orgId: ticket.organisationId })
      if (r.is_error) {
        toolErrorCount += 1
        if (!firstToolError) {
          firstToolError = { tool: tu.name, detail: r.content.slice(0, 400) }
        }
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: r.content,
        is_error: r.is_error,
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  // If tools kept failing, don't post an apology reply to the customer — that
  // leaks implementation trouble and makes us look broken. Flag the ticket so
  // the admin health banner picks it up and staff can take over.
  const toolsBroken =
    toolCallCount >= 2 && toolErrorCount >= 2 && toolErrorCount / toolCallCount >= 0.5
  if (toolsBroken && firstToolError) {
    const reason = `AI tool error (${firstToolError.tool}): ${firstToolError.detail}`
    await db
      .update(supportTickets)
      .set({
        aiPaused: true,
        aiFlagReason: reason,
        status: 'pending_staff',
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, ticketId))
    return { kind: 'error', reason: 'tool-errors' }
  }

  if (!finalText) finalText = 'I was unable to produce a reply. A human will follow up shortly.'

  const latencyMs = Date.now() - started
  const [inserted] = await db
    .insert(supportMessages)
    .values({
      ticketId,
      author: 'ai',
      body: finalText,
      aiModelId: env.supportAiModelId,
      aiInputTokens: totalInput,
      aiOutputTokens: totalOutput,
      aiLatencyMs: latencyMs,
    })
    .returning({ id: supportMessages.id })
  if (!inserted) return { kind: 'error', reason: 'insert-failed' }

  await db
    .update(supportTickets)
    .set({ lastMessageAt: new Date(), status: 'pending_customer', updatedAt: new Date() })
    .where(eq(supportTickets.id, ticketId))
  await recordAiResponse(ticketId)

  return { kind: 'replied', messageId: inserted.id }
}
